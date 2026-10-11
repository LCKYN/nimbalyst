// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { TranscriptViewMessage } from '@nimbalyst/runtime/ai/server/transcript/TranscriptProjector';
import { reconcileTranscriptMessages } from '../transcriptReconciliation';

const msg = (
  id: number,
  type: TranscriptViewMessage['type'],
  text: string,
  at: number,
  extra: Partial<TranscriptViewMessage> = {},
): TranscriptViewMessage => ({
  id,
  sequence: id < 0 ? -1 : id,
  createdAt: new Date(at),
  type,
  text,
  subagentId: null,
  ...extra,
});

const persistedError = msg(1, 'system_message', 'session limit', 1000, { isError: true });
const optimisticError = msg(-1, 'system_message', 'Error: session limit', 1100, { isError: true });

describe('reconcileTranscriptMessages', () => {
  it('keeps an optimistic error until a newer persisted user message arrives', () => {
    const current = [persistedError, optimisticError];
    expect(reconcileTranscriptMessages(current, [persistedError]).map((m) => m.id)).toEqual([1, -1]);

    const next = reconcileTranscriptMessages(current, [
      persistedError,
      msg(2, 'user_message', 'continue', 5000),
    ]);
    expect(next.map((m) => m.id)).toEqual([1, 2]);
  });

  it('still acknowledges an optimistic user message', () => {
    const optimisticUser = msg(-2, 'user_message', 'hello', 1000);
    const next = reconcileTranscriptMessages([optimisticUser], [msg(1, 'user_message', 'hello', 1200)]);
    expect(next.map((m) => m.id)).toEqual([1]);
  });
});
