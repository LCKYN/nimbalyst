type Invoke = (channel: string, ...args: unknown[]) => Promise<any>;

/**
 * Send-now: (1) interrupt the current turn (graceful for Claude Code, hard
 * abort for other providers via the BaseAIProvider default); (2) explicitly
 * trigger queue processing. The natural completion-handler path also triggers
 * it, and the server's sessionsProcessingQueue guard de-dupes, so this is safe
 * to call. We don't rely on the isLoading auto-effect because
 * session:completed may race or, in some edge cases, may not fire cleanly
 * after abort.
 *
 * #1682: while a commit proposal is open the main process holds the interrupt
 * and sends the queued prompt itself once the proposal settles. Report that so
 * the queue can say so instead of the button looking dead.
 */
export async function sendQueuedPromptNow(
  invoke: Invoke,
  sessionId: string,
  workspacePath: string | undefined,
): Promise<'sent' | 'held-for-commit'> {
  const result = await invoke('ai:interruptCurrentTurn', sessionId);
  if (result?.deferred === 'commit-in-flight') {
    return 'held-for-commit';
  }
  if (workspacePath) {
    await invoke('ai:triggerQueueProcessing', sessionId, workspacePath, 'send-now');
  }
  return 'sent';
}
