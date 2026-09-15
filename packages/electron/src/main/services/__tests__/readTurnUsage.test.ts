// @vitest-environment node
import { describe, it, expect } from 'vitest';

import { readTurnUsage } from '../UsageAnalyticsService';

/**
 * There is no token column in the database. Per-turn usage exists only inside
 * the raw provider frame stored in `ai_agent_messages.content`, and the two
 * providers spell it differently -- codex reports cached input as part of
 * `input_tokens` and separately in `cached_input_tokens`, so counting its
 * `input_tokens` whole would double-count the cache.
 */
describe('readTurnUsage', () => {
  it('reads a claude-code result frame', () => {
    const frame = JSON.stringify({ type: 'result', usage: { input_tokens: 1200, output_tokens: 340 } });
    expect(readTurnUsage(frame)).toEqual({ inputTokens: 1200, outputTokens: 340 });
  });

  it('nets cached input off a codex turn so the cache is not counted twice', () => {
    const frame = JSON.stringify({
      usage: { input_tokens: 1000, cached_input_tokens: 900, output_tokens: 50 },
    });
    expect(readTurnUsage(frame)).toEqual({ inputTokens: 100, outputTokens: 50 });
  });

  it('never reports negative input when the cache exceeds the reported input', () => {
    const frame = JSON.stringify({ usage: { input_tokens: 10, cached_input_tokens: 99, output_tokens: 1 } });
    expect(readTurnUsage(frame)?.inputTokens).toBe(0);
  });

  // Most rows in the log are not turn results. They must return null so the
  // caller skips them, rather than banking a zero into the bucket.
  it('returns null for a frame with no usage at all', () => {
    expect(readTurnUsage(JSON.stringify({ type: 'assistant', message: {} }))).toBeNull();
    expect(readTurnUsage('not json')).toBeNull();
    expect(readTurnUsage(null)).toBeNull();
    expect(readTurnUsage(JSON.stringify({ usage: 'nonsense' }))).toBeNull();
  });

  it('treats a missing half of the pair as zero rather than NaN', () => {
    expect(readTurnUsage(JSON.stringify({ usage: { input_tokens: 500 } }))).toEqual({
      inputTokens: 500,
      outputTokens: 0,
    });
  });
});
