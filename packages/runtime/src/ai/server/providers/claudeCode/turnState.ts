/**
 * Per-turn mutable state for `ClaudeCodeProvider.sendMessage()`.
 *
 * `sendMessage` is one async generator whose chunk loop writes a pile of locals
 * that its epilogue then reads: `completeEmitted` / `fullContent` /
 * `toolCallCount` together decide whether an empty slash command reports an
 * error, `sawAssistantOutputThisTurn` gates the crash-retry, `stderrLines`
 * enriches the error message. Splitting the method means those locals have to
 * cross a function boundary, and passing them by value would break the epilogue
 * silently — the turn would still stream text, it would just stop completing
 * correctly.
 *
 * So they live here instead, in one object created at the top of the turn and
 * threaded by reference into every extracted piece.
 *
 * This is deliberately NOT hung off `ClaudeCodeProvider`. A provider instance is
 * reused across turns; anything promoted to instance state leaks into the next
 * turn. Instance fields on the provider (`drainingBackgroundTasks`,
 * `promptEndTimer`, …) are the ones that intentionally outlive a turn or are
 * read by `abort()` from outside it — those stay where they are.
 */

import type { ParsedContextUsage } from '../../utils/contextUsage';
import type { TokenUsageBucket } from '../../types';

/** Token counts as the SDK reports them (snake_case wire shape). */
export interface TurnUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

/** Per-model usage from the SDK's `result` chunk (camelCase, unlike `TurnUsage`). */
export interface TurnModelUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  costUSD?: number;
  contextWindow?: number;
  webSearchRequests?: number;
}

/** A tool call yielded at `tool_use` and mutated in place when its result lands. */
export interface TurnToolCall {
  id: string;
  name: string;
  arguments?: Record<string, any>;
  /** Attached in place when the matching `tool_result` arrives; shape is tool-specific. */
  result?: any;
  isError?: boolean;
}

/** Process attributes captured after the SDK options are built, for crash diagnostics (#614, #1361). */
export interface SpawnDiagnosticsContext {
  binaryPath?: string;
  cwd?: string;
}

export interface TurnState {
  /** Wall clock at turn entry; the epilogue reports elapsed time from it. */
  readonly startTime: number;
  /** `markMessagesAsHidden` captured and reset at entry, before any await. */
  readonly hideMessages: boolean;
  /**
   * The caller's message before document context and attachment instructions
   * were appended. The crash-retry path re-enters `sendMessage` with it (#1361).
   */
  readonly originalMessage: string;

  /** The message actually sent to the SDK, after context/attachment rewriting. */
  message: string;
  /** Whether the user's prompt started with `/`. Drives the empty-output check. */
  isSlashCommand: boolean;

  /** Rolling tail of subprocess stderr; the writer caps its length. */
  readonly stderrLines: string[];
  /** Set once the SDK options are known, so the catch block can log spawn diagnostics. */
  spawnDiagContext: SpawnDiagnosticsContext | null;

  /** Accumulated assistant text. Empty + no tool calls is how a dead slash command is detected. */
  fullContent: string;
  /** Chunks seen from the SDK this turn (diagnostics only). */
  chunkCount: number;
  /** When the first chunk arrived, for the slow-spawn warning. */
  firstChunkTime: number | undefined;
  /** Tool calls started this turn. Part of the empty-slash-command check. */
  toolCallCount: number;
  /** A `compact_boundary` arrived, so empty `fullContent` is expected. */
  receivedCompactBoundary: boolean;
  /**
   * Tool calls whose result has not come back. While > 0 a tool is running in
   * the subprocess and main-stream silence is legitimate, so the stall watchdog
   * stays disarmed. NIM-1481.
   */
  outstandingToolCalls: number;
  /** When the first real `result` chunk landed; arms the prompt-end grace timer. */
  resultReceivedTime: number | null;
  /** `chunkCount` at that moment, for the stream-closed diagnostics. */
  resultReceivedChunkCount: number | null;
  /**
   * A terminal `complete` has already been yielded. Every later path must check
   * this before yielding another, and the catch block reads it to avoid
   * double-completing a turn that already reached the consumer.
   */
  completeEmitted: boolean;
  /**
   * Any assistant text or tool call reached the transcript. The crash-retry
   * decision needs it: replaying a partially-streamed turn would duplicate it.
   */
  sawAssistantOutputThisTurn: boolean;
  /**
   * A `task_notification` arrived this turn, which makes an immediately
   * following empty `num_turns: 0` result a notification flush rather than the
   * end of the turn. NIM-1470.
   */
  sawTaskNotificationThisTurn: boolean;

  /** Latest usage seen; overwritten by the cumulative `result.usage`. */
  usageData: TurnUsage | undefined;
  /**
   * The last assistant message's per-step usage. Context fill is computed from
   * this, NOT from `usageData` — that one holds cumulative totals by turn end.
   */
  lastAssistantUsage: TurnUsage | undefined;
  /** Only set on a `/context` turn, from the SDK's structured twin of the report. */
  structuredContextUsage: ParsedContextUsage | undefined;
  /** Per-model usage from the SDK's `result` chunk; the only per-model cost source. */
  modelUsageData: Record<string, TurnModelUsage> | undefined;

  /**
   * Per-step token counts, tagged by origin (`main` lead conversation vs.
   * `subagent` Task-tool runs) and keyed by the model that produced them.
   * Populated from EVERY per-step assistant chunk this turn -- including
   * sub-agent chunks, unlike `usageData`/`lastAssistantUsage` which guard
   * those out (NIM-671/#457, NIM-868). Used ONLY to decide, at `complete`,
   * which bucket (`mainUsage`/`subagentUsage`) each of the authoritative
   * `modelUsageData` entries belongs to -- never to recompute totals, or it
   * reintroduces the modelUsage double-counting fixed by NIM-689.
   */
  readonly originModelUsage: {
    main: Record<string, TurnModelUsage>;
    subagent: Record<string, TurnModelUsage>;
  };

  /** `tool_use` id → the call object yielded to the consumer and mutated on result. */
  readonly toolCallsById: Map<string, TurnToolCall>;
}

export function createTurnState(init: {
  startTime: number;
  hideMessages: boolean;
  originalMessage: string;
}): TurnState {
  return {
    startTime: init.startTime,
    hideMessages: init.hideMessages,
    originalMessage: init.originalMessage,

    message: init.originalMessage,
    isSlashCommand: false,

    stderrLines: [],
    spawnDiagContext: null,

    fullContent: '',
    chunkCount: 0,
    firstChunkTime: undefined,
    toolCallCount: 0,
    receivedCompactBoundary: false,
    outstandingToolCalls: 0,
    resultReceivedTime: null,
    resultReceivedChunkCount: null,
    completeEmitted: false,
    sawAssistantOutputThisTurn: false,
    sawTaskNotificationThisTurn: false,

    usageData: undefined,
    lastAssistantUsage: undefined,
    structuredContextUsage: undefined,
    modelUsageData: undefined,
    originModelUsage: { main: {}, subagent: {} },

    toolCallsById: new Map(),
  };
}

/** Accumulate one per-step usage snapshot (SDK snake_case) into a running `TurnModelUsage` bucket. */
export function accumulateTurnModelUsage(
  existing: TurnModelUsage | undefined,
  step: TurnUsage,
): TurnModelUsage {
  return {
    inputTokens: (existing?.inputTokens || 0) + (step.input_tokens || 0),
    outputTokens: (existing?.outputTokens || 0) + (step.output_tokens || 0),
    cacheReadInputTokens: (existing?.cacheReadInputTokens || 0) + (step.cache_read_input_tokens || 0),
    cacheCreationInputTokens: (existing?.cacheCreationInputTokens || 0) + (step.cache_creation_input_tokens || 0),
  };
}

/** Sum two authoritative `TurnModelUsage` entries (camelCase, as found in `modelUsageData`). */
// Returns a TokenUsageBucket, not a TurnModelUsage: every field below is
// already a concrete number, and the buckets ride out on `StreamChunk`'s
// `mainUsage`/`subagentUsage`, which require `inputTokens`/`outputTokens`.
function sumTurnModelUsage(a: TokenUsageBucket | undefined, b: TurnModelUsage): TokenUsageBucket {
  return {
    inputTokens: (a?.inputTokens || 0) + (b.inputTokens || 0),
    outputTokens: (a?.outputTokens || 0) + (b.outputTokens || 0),
    cacheReadInputTokens: (a?.cacheReadInputTokens || 0) + (b.cacheReadInputTokens || 0),
    cacheCreationInputTokens: (a?.cacheCreationInputTokens || 0) + (b.cacheCreationInputTokens || 0),
    costUSD: (a?.costUSD || 0) + (b.costUSD || 0),
  };
}

/**
 * Split the SDK's authoritative per-model totals (`modelUsageData`, from the
 * terminal `result` chunk) into `mainUsage`/`subagentUsage` buckets, using
 * `originModelUsage` ONLY to decide which bucket each model's ENTIRE entry
 * belongs to -- never to recompute the totals themselves (that would
 * reintroduce the modelUsage double-counting NIM-689 fixed).
 *
 * Whole-model attribution, not token-level splitting: a model that appeared
 * under `main` this turn (even once) has its full authoritative total counted
 * as main. This is deliberately conservative -- it correctly handles the
 * common case (a sub-agent runs a cheaper model than the lead) and documents,
 * rather than fixes, the rare case where main and a sub-agent share a model in
 * the same turn (that model's total lands entirely in `mainUsage`).
 */
export function attributeModelUsageByOrigin(
  modelUsageData: Record<string, TurnModelUsage> | undefined,
  originModelUsage: TurnState['originModelUsage'],
): { mainUsage: TokenUsageBucket | undefined; subagentUsage: TokenUsageBucket | undefined } {
  if (!modelUsageData) return { mainUsage: undefined, subagentUsage: undefined };

  let mainUsage: TokenUsageBucket | undefined;
  let subagentUsage: TokenUsageBucket | undefined;

  for (const [modelName, modelStats] of Object.entries(modelUsageData)) {
    const isMain = Object.prototype.hasOwnProperty.call(originModelUsage.main, modelName);
    if (isMain) {
      mainUsage = sumTurnModelUsage(mainUsage, modelStats);
    } else {
      subagentUsage = sumTurnModelUsage(subagentUsage, modelStats);
    }
  }

  return { mainUsage, subagentUsage };
}
