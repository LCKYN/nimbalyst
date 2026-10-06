import React, { useState } from 'react';
import { useAtomValue } from 'jotai';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import { sessionErrorNoticeAtom } from '../../store/atoms/sessionTranscript';
import { sessionWakeupAtom } from '../../store/atoms/sessions';

interface UsageLimitContinueBarProps {
  sessionId: string;
  workspacePath: string;
}

/**
 * Offered after a usage-limit error: schedules "continue" for just after the
 * limit resets. Once the wakeup exists, WakeupBanner takes over.
 */
export function UsageLimitContinueBar({ sessionId, workspacePath }: UsageLimitContinueBarProps) {
  const notice = useAtomValue(sessionErrorNoticeAtom(sessionId));
  const wakeup = useAtomValue(sessionWakeupAtom(sessionId));
  const [busy, setBusy] = useState(false);

  if (notice?.kind !== 'usage_limit' || !notice.resetsAt || notice.resetsAt <= Date.now() || wakeup) {
    return null;
  }
  const resetsAt = notice.resetsAt;

  const scheduleContinue = async () => {
    setBusy(true);
    try {
      await window.electronAPI.invoke('wakeup:create', {
        sessionId,
        workspacePath,
        prompt: 'continue',
        fireAt: resetsAt + 60_000,
      });
    } catch (error) {
      console.error('[UsageLimitContinueBar] wakeup:create failed', error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="usage-limit-continue flex items-center gap-2 px-3 py-1.5 border-b border-[var(--nim-border)] text-[13px] text-[var(--nim-text-muted)]"
      data-testid="usage-limit-continue"
    >
      <MaterialSymbol icon="error" size={14} className="shrink-0 text-[var(--nim-error)]" />
      <span className="flex-1">
        Usage limit reached · resets {new Date(resetsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
      </span>
      <button
        type="button"
        onClick={scheduleContinue}
        disabled={busy}
        className="shrink-0 px-2 py-0.5 rounded border border-[var(--nim-border)] bg-transparent text-[var(--nim-text)] cursor-pointer hover:enabled:bg-[var(--nim-bg-hover)] disabled:opacity-50 disabled:cursor-not-allowed"
        data-testid="usage-limit-continue-button"
      >
        Continue when it resets
      </button>
    </div>
  );
}
