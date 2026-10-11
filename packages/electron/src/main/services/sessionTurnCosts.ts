/**
 * Per-turn cost for one session, from its raw `ai_agent_messages` frames, so
 * the AI Usage report can show which prompts were expensive.
 *
 * A turn starts at each prompt (`direction = 'input'`) and owns every priced
 * frame up to the next prompt. Both providers report RUNNING totals, so a
 * turn's cost is the difference from the previous priced frame:
 *
 * - **Claude Code** `result` frames carry `modelUsage`, per model, cumulative
 *   for the whole session -- it carries on across resumes and app restarts, and
 *   the `system/init` frame that precedes every turn does NOT reset it. An
 *   interrupted turn reports `usage` all zero while `modelUsage` still grows, so
 *   `usage` is not used for cost.
 * - **Codex** (legacy SDK transport) `turn.completed` frames carry cumulative
 *   thread `usage` (see c9a482077). The app-server transport stores no usage
 *   frames, so its sessions get no priced turns.
 *
 * A running total that goes down means the agent started counting again; the
 * new value is then the delta.
 *
 * Pure: the service does the query, this does the arithmetic.
 */

import type { CostSplitUSD } from '@nimbalyst/runtime/ai/pricing/modelPricing';
import { scaleCostSplit, sumCostSplit } from '@nimbalyst/runtime/ai/pricing/modelPricing';
import { addCostSplit, splitProportions } from './usageOverview';

export interface StoredFrame {
  direction: string;
  createdAtMs: number;
  /** Raw `content` column: a JSON string, plain prompt text, or an already-parsed object. */
  content: unknown;
  metadata: unknown;
}

export type TurnTokens = CostSplitUSD;

export interface SessionTurn {
  /** 1-based turn number within the whole session. */
  index: number;
  /** Prompt time. */
  startedAt: number;
  /** Last priced frame of the turn; null when the turn never finished. */
  endedAt: number | null;
  /** Whitespace collapsed to one line, up to `PREVIEW_CHARS`; '' when the prompt had no text. */
  promptPreview: string;
  costUSD: number;
  split: CostSplitUSD;
  tokens: TurnTokens;
  /** Previous turn's end to this prompt; null for the first turn or after an unfinished one. */
  idleGapMs: number | null;
  /** The prompt cache lifetime this turn's writes used: 5 minutes, or 1 hour when the provider says so. */
  cacheTtlMs: number;
  cacheLikelyExpired: boolean;
}

const PREVIEW_CHARS = 500;
const FIVE_MINUTES_MS = 5 * 60_000;
const ONE_HOUR_MS = 60 * 60_000;
/** Share of a turn's cost that must be cache writes before an idle gap is blamed for it. */
const CACHE_EXPIRED_WRITE_SHARE = 0.4;

interface Running {
  costUSD: number;
  tokens: TurnTokens;
}

const ZERO: TurnTokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const KINDS = ['input', 'output', 'cacheRead', 'cacheWrite'] as const;

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function parseRecord(raw: unknown): Record<string, any> | null {
  if (raw && typeof raw === 'object') return raw as Record<string, any>;
  if (typeof raw !== 'string' || !raw.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** Claude Code input rows are `{ prompt, options }`; Codex ones are the prompt text. */
export function promptPreview(content: unknown): string {
  const record = parseRecord(content);
  let text = record ? (typeof record.prompt === 'string' ? record.prompt : '') : typeof content === 'string' ? content : '';
  // Nimbalyst appends editor context to the prompt; it is not what the user typed.
  const systemMessage = text.indexOf('<NIMBALYST_SYSTEM_MESSAGE>');
  if (systemMessage !== -1) text = text.slice(0, systemMessage);
  return text.replace(/\s+/g, ' ').trim().slice(0, PREVIEW_CHARS);
}

function readClaudeRunning(content: Record<string, any>): Map<string, Running> | null {
  if (content.type !== 'result' || !content.modelUsage || typeof content.modelUsage !== 'object') return null;
  const byModel = new Map<string, Running>();
  for (const [model, raw] of Object.entries(content.modelUsage as Record<string, any>)) {
    if (!raw || typeof raw !== 'object') continue;
    byModel.set(model, {
      costUSD: num(raw.costUSD),
      tokens: {
        input: num(raw.inputTokens),
        output: num(raw.outputTokens),
        cacheRead: num(raw.cacheReadInputTokens),
        cacheWrite: num(raw.cacheCreationInputTokens),
      },
    });
  }
  return byModel;
}

function readCodexRunning(content: Record<string, any>): Map<string, Running> | null {
  const usage = content.usage;
  if (!usage || typeof usage !== 'object') return null;
  const cached = num(usage.cached_input_tokens);
  return new Map([[
    'codex',
    {
      costUSD: 0,
      tokens: { input: Math.max(num(usage.input_tokens) - cached, 0), output: num(usage.output_tokens), cacheRead: cached, cacheWrite: 0 },
    },
  ]]);
}

/** Per-key difference from the previous running totals, or the totals themselves after a restart. */
function runningDelta(current: Map<string, Running>, previous: Map<string, Running>): Map<string, Running> {
  const fieldsOf = (r: Running) => [r.costUSD, ...KINDS.map((k) => r.tokens[k])];
  const restarted = [...previous].some(([key, prev]) => {
    const now = fieldsOf(current.get(key) ?? { costUSD: 0, tokens: ZERO });
    return fieldsOf(prev).some((value, i) => now[i] < value - 1e-9);
  });
  const delta = new Map<string, Running>();
  for (const [key, now] of current) {
    const base = restarted ? undefined : previous.get(key);
    const step = (k: (typeof KINDS)[number]) => Math.max(now.tokens[k] - (base?.tokens[k] ?? 0), 0);
    delta.set(key, {
      costUSD: Math.max(now.costUSD - (base?.costUSD ?? 0), 0),
      tokens: { input: step('input'), output: step('output'), cacheRead: step('cacheRead'), cacheWrite: step('cacheWrite') },
    });
  }
  return delta;
}

function toUsage(tokens: TurnTokens) {
  return {
    inputTokens: tokens.input,
    outputTokens: tokens.output,
    cacheReadInputTokens: tokens.cacheRead,
    cacheCreationInputTokens: tokens.cacheWrite,
  };
}

export function buildSessionTurns(frames: StoredFrame[], provider: string, model: string | null): SessionTurn[] {
  const isClaude = provider.startsWith('claude-code');
  const isCodex = provider === 'openai-codex';
  if (!isClaude && !isCodex) return [];

  const turns: SessionTurn[] = [];
  let current: SessionTurn | null = null;
  let previous = new Map<string, Running>();

  for (const frame of frames) {
    if (frame.direction === 'input') {
      // A system reminder runs its own agent turn; it is not one of the user's
      // prompts, so its cost is charged to no turn.
      if (parseRecord(frame.metadata)?.promptType === 'system_reminder') {
        current = null;
        continue;
      }
      current = {
        index: turns.length + 1,
        startedAt: frame.createdAtMs,
        endedAt: null,
        promptPreview: promptPreview(frame.content),
        costUSD: 0,
        split: { ...ZERO },
        tokens: { ...ZERO },
        idleGapMs: null,
        cacheTtlMs: FIVE_MINUTES_MS,
        cacheLikelyExpired: false,
      };
      turns.push(current);
      continue;
    }

    const content = parseRecord(frame.content);
    if (!content) continue;
    const running = isClaude
      ? readClaudeRunning(content)
      : parseRecord(frame.metadata)?.eventType === 'turn.completed' ? readCodexRunning(content) : null;
    if (!running) continue;
    const delta = runningDelta(running, previous);
    previous = running;
    if (!current) continue;

    for (const [key, step] of delta) {
      // Claude's token counts can be inflated by duplicate stream events (see
      // ClaudeCodeProvider); its cost is exact. The tokens only supply the
      // proportions, so the split still adds up to the exact cost.
      const estimate = splitProportions(provider, isClaude ? key : model ?? undefined, toUsage(step.tokens));
      const costUSD = isClaude ? step.costUSD : estimate ? sumCostSplit(estimate) : 0;
      if (estimate) current.split = addCostSplit(current.split, scaleCostSplit(estimate, costUSD));
      current.costUSD += costUSD;
      current.tokens = addCostSplit(current.tokens, step.tokens);
    }
    current.endedAt = frame.createdAtMs;
    if (num(content.usage?.cache_creation?.ephemeral_1h_input_tokens) > 0) current.cacheTtlMs = ONE_HOUR_MS;
  }

  for (let i = 1; i < turns.length; i++) {
    const turn = turns[i];
    const endedBefore = turns[i - 1].endedAt;
    turn.idleGapMs = endedBefore === null ? null : Math.max(turn.startedAt - endedBefore, 0);
    // ponytail: TTL read off this turn's own writes; a session that switches TTL mid-way can misflag one turn.
    turn.cacheLikelyExpired = turn.idleGapMs !== null
      && turn.idleGapMs >= turn.cacheTtlMs
      && turn.costUSD > 0
      && turn.split.cacheWrite >= CACHE_EXPIRED_WRITE_SHARE * turn.costUSD;
  }
  return turns;
}
