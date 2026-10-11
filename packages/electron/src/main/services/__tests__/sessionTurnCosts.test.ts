// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildSessionTurns, type StoredFrame } from '../sessionTurnCosts';

// Trimmed from real `ai_agent_messages` rows.
const T0 = Date.UTC(2026, 9, 11, 16, 0);
const MIN = 60_000;
const OPUS = 'claude-opus-5-5[1m]';

function prompt(atMs: number, text: string, metadata: Record<string, unknown> = { mode: 'agent' }): StoredFrame {
  return {
    direction: 'input',
    createdAtMs: atMs,
    content: JSON.stringify({ prompt: text, options: { model: OPUS, resume: 'x' } }),
    metadata: JSON.stringify(metadata),
  };
}

const init = (atMs: number): StoredFrame => ({
  direction: 'output',
  createdAtMs: atMs,
  content: JSON.stringify({ type: 'system', subtype: 'init', session_id: 'x' }),
  metadata: null,
});

/** `modelUsage` is the running total since the agent started counting. */
function result(
  atMs: number,
  modelUsage: Record<string, { costUSD: number; inputTokens?: number; outputTokens?: number; cacheReadInputTokens?: number; cacheCreationInputTokens?: number }>,
  usage: Record<string, unknown> = { input_tokens: 12, cache_creation: { ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 0 } },
): StoredFrame {
  return {
    direction: 'output',
    createdAtMs: atMs,
    content: JSON.stringify({ type: 'result', subtype: 'success', usage, modelUsage }),
    metadata: null,
  };
}

describe('buildSessionTurns: Claude Code', () => {
  it('charges each turn the growth of the running totals, across init frames, restarts and interruptions', () => {
    const turns = buildSessionTurns([
      prompt(T0, 'review plan\n\n  once   more\n<NIMBALYST_SYSTEM_MESSAGE>\nThe user is looking at a doc'),
      init(T0 + 1_000),
      result(T0 + MIN, { [OPUS]: { costUSD: 0.9, outputTokens: 1_000 }, 'claude-haiku-5-5': { costUSD: 0.1, inputTokens: 500 } }),
      // init precedes every turn and does not reset the running total.
      prompt(T0 + 2 * MIN, ''),
      init(T0 + 2 * MIN + 1_000),
      result(T0 + 3 * MIN, { [OPUS]: { costUSD: 2.4, outputTokens: 3_000 }, 'claude-haiku-5-5': { costUSD: 0.1, inputTokens: 500 } }),
      // A system reminder is its own turn, charged to no prompt.
      prompt(T0 + 3 * MIN + 10, 'background task settled', { promptType: 'system_reminder' }),
      result(T0 + 3 * MIN + 20, { [OPUS]: { costUSD: 2.5, outputTokens: 3_100 }, 'claude-haiku-5-5': { costUSD: 0.1, inputTokens: 500 } }),
      // Interrupted: `usage` all zero, `modelUsage` still grows.
      prompt(T0 + 4 * MIN, 'stop'),
      result(T0 + 4 * MIN + 5, { [OPUS]: { costUSD: 2.87, outputTokens: 3_200 }, 'claude-haiku-5-5': { costUSD: 0.1, inputTokens: 500 } }, { input_tokens: 0, output_tokens: 0 }),
      // The total went down: the agent started counting again.
      prompt(T0 + 5 * MIN, 'again'),
      result(T0 + 6 * MIN, { [OPUS]: { costUSD: 0.3, outputTokens: 100 } }),
    ], 'claude-code', 'claude-code:opus-1m');

    expect(turns.map((t) => t.index)).toEqual([1, 2, 3, 4]);
    expect(turns.map((t) => t.costUSD)).toEqual([expect.closeTo(1, 9), expect.closeTo(1.5, 9), expect.closeTo(0.37, 9), expect.closeTo(0.3, 9)]);
    expect(turns[0].promptPreview).toBe('review plan once more');
    expect(turns[1].promptPreview).toBe('');
    // Each model's tokens supply the proportions, scaled to its exact cost.
    expect(turns[0].split.input).toBeCloseTo(0.1, 9);
    expect(turns[0].split.output).toBeCloseTo(0.9, 9);
    expect(turns[0].tokens).toEqual({ input: 500, output: 1_000, cacheRead: 0, cacheWrite: 0 });
    expect(turns[1].idleGapMs).toBe(MIN);
    expect(turns[3].idleGapMs).toBe(MIN - 5);
  });

  it('flags a turn after an idle gap longer than the cache lifetime, when cache writes dominate its cost', () => {
    const rewrite = (atMs: number, totalCost: number, oneHour = false) =>
      result(
        atMs,
        { [OPUS]: { costUSD: totalCost, cacheCreationInputTokens: totalCost * 100_000 } },
        { cache_creation: { ephemeral_5m_input_tokens: oneHour ? 0 : 1, ephemeral_1h_input_tokens: oneHour ? 1 : 0 } },
      );
    const turns = buildSessionTurns([
      prompt(T0, 'a'), rewrite(T0 + MIN, 1),
      prompt(T0 + 5 * MIN, 'four minutes later'), rewrite(T0 + 6 * MIN, 2),
      prompt(T0 + 12 * MIN, 'six minutes later'), rewrite(T0 + 13 * MIN, 3),
      prompt(T0 + 19 * MIN, 'six minutes, 1h cache'), rewrite(T0 + 20 * MIN, 4, true),
    ], 'claude-code', null);

    expect(turns.map((t) => t.cacheLikelyExpired)).toEqual([false, false, true, false]);
  });
});

describe('buildSessionTurns: Codex and others', () => {
  it('diffs cumulative turn.completed usage and prices it from the session model', () => {
    const codexPrompt = (atMs: number, text: string): StoredFrame =>
      ({ direction: 'input', createdAtMs: atMs, content: text, metadata: JSON.stringify({ promptType: 'user' }) });
    const completed = (atMs: number, input: number, cached: number, output: number): StoredFrame => ({
      direction: 'output',
      createdAtMs: atMs,
      content: JSON.stringify({ usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output } }),
      metadata: JSON.stringify({ eventType: 'turn.completed' }),
    });
    const turns = buildSessionTurns([
      codexPrompt(T0, 'hello'), completed(T0 + 1_000, 1_000_000, 0, 0),
      codexPrompt(T0 + 2_000, 'follow up'), completed(T0 + 3_000, 2_000_000, 1_000_000, 100_000),
    ], 'openai-codex', 'openai-codex:gpt-5');

    expect(turns[0].costUSD).toBeCloseTo(1.25, 9);
    expect(turns[1].tokens).toEqual({ input: 0, output: 100_000, cacheRead: 1_000_000, cacheWrite: 0 });
    expect(turns[1].split).toEqual({ input: 0, output: expect.closeTo(1, 9), cacheRead: expect.closeTo(0.125, 9), cacheWrite: 0 });
  });

  it('returns nothing for a provider without per-turn data', () => {
    expect(buildSessionTurns([prompt(T0, 'hi')], 'lmstudio', 'lmstudio:llama')).toEqual([]);
  });
});
