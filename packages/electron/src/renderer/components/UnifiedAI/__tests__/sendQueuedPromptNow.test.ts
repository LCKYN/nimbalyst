// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { sendQueuedPromptNow } from '../sendQueuedPromptNow';

describe('sendQueuedPromptNow', () => {
  it('interrupts, then drives the queue', async () => {
    const invoke = vi.fn().mockResolvedValue({ success: true, method: 'interrupt' });

    await expect(sendQueuedPromptNow(invoke, 's1', '/ws')).resolves.toBe('sent');
    expect(invoke.mock.calls).toEqual([
      ['ai:interruptCurrentTurn', 's1'],
      ['ai:triggerQueueProcessing', 's1', '/ws', 'send-now'],
    ]);
  });

  it('reports a send-now held behind an open commit proposal instead of driving', async () => {
    const invoke = vi.fn().mockResolvedValue({ success: false, deferred: 'commit-in-flight' });

    await expect(sendQueuedPromptNow(invoke, 's1', '/ws')).resolves.toBe('held-for-commit');
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
