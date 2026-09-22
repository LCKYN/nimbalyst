import React, { useCallback, useEffect, useState } from 'react';
import { useAtomValue } from 'jotai';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import { sessionWakeupAtom, type SessionWakeupView } from '../../store/atoms/sessions';
import { AttachmentIndicator } from '../UnifiedAI/PromptQueueList';

interface WakeupBannerProps {
  sessionId?: string | null;
}

function formatRelativeFireAt(fireAt: number): string {
  const ms = fireAt - Date.now();
  if (ms <= 0) return 'now';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `in ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `in ${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `in ${days}d ${hours % 24}h`;
}

function formatAbsoluteFireAt(fireAt: number): string {
  return new Date(fireAt).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Right-aligned timing chip. Kept short because it sits inline before the
 * actions; the long-form explanation moves to the row's title tooltip.
 */
function statusLabel(wakeup: SessionWakeupView): string {
  switch (wakeup.status) {
    case 'pending':
      return `${formatRelativeFireAt(wakeup.fireAt)} · ${formatAbsoluteFireAt(wakeup.fireAt)}`;
    case 'firing':
      return 'Resuming…';
    case 'waiting_for_workspace':
      return 'Waiting for workspace';
    case 'overdue': {
      const hoursAgo = Math.max(0, Math.floor((Date.now() - wakeup.fireAt) / 3_600_000));
      return hoursAgo > 0 ? `Due ${hoursAgo}h ago` : 'Due now';
    }
    default:
      return '';
  }
}

/** Long-form status, shown on hover so the compact chip stays readable. */
function statusTooltip(wakeup: SessionWakeupView): string {
  const parts: string[] = [];
  switch (wakeup.status) {
    case 'pending':
      parts.push(`Scheduled to resume ${formatRelativeFireAt(wakeup.fireAt)} (${formatAbsoluteFireAt(wakeup.fireAt)})`);
      break;
    case 'firing':
      parts.push('Resuming session…');
      break;
    case 'waiting_for_workspace':
      parts.push('Waiting for the workspace window to open');
      break;
    case 'overdue':
      parts.push('Wakeup was due while the app was closed — fire now or cancel?');
      break;
  }
  if (wakeup.reason) parts.push(`Reason: ${wakeup.reason}`);
  parts.push(wakeup.prompt);
  return parts.join('\n');
}

export function WakeupBanner({ sessionId }: WakeupBannerProps) {
  const effectiveSessionId = sessionId || '__no_session__';
  const wakeup = useAtomValue(sessionWakeupAtom(effectiveSessionId));
  const [busy, setBusy] = useState(false);
  const [, setTick] = useState(0);

  // Re-render every 30s so the relative time stays fresh.
  useEffect(() => {
    if (!wakeup || wakeup.status !== 'pending') return;
    const interval = setInterval(() => setTick(t => t + 1), 30_000);
    return () => clearInterval(interval);
  }, [wakeup]);

  const handleCancel = useCallback(async () => {
    if (!wakeup || busy) return;
    setBusy(true);
    try {
      await window.electronAPI.invoke('wakeup:cancel', wakeup.id);
    } catch (error) {
      console.error('[WakeupBanner] cancel failed', error);
    } finally {
      setBusy(false);
    }
  }, [wakeup, busy]);

  const handleRunNow = useCallback(async () => {
    if (!wakeup || busy) return;
    setBusy(true);
    try {
      await window.electronAPI.invoke('wakeup:run-now', wakeup.id);
    } catch (error) {
      console.error('[WakeupBanner] run-now failed', error);
    } finally {
      setBusy(false);
    }
  }, [wakeup, busy]);

  if (!sessionId) return null;
  if (!wakeup) return null;

  const isOverdue = wakeup.status === 'overdue';
  // Tint everything off a single accent var so the banner tracks the active
  // theme instead of hardcoded Tailwind palette colors.
  const accent = isOverdue ? 'var(--nim-warning)' : 'var(--nim-primary)';
  const containerStyle = {
    backgroundColor: `color-mix(in srgb, ${accent} 8%, transparent)`,
    borderBottomColor: `color-mix(in srgb, ${accent} 20%, transparent)`,
  };
  // Mirrors .prompt-queue-item so a scheduled prompt and a queued prompt read
  // as the same kind of thing: content left, timing right, actions last.
  const iconButtonClass =
    'shrink-0 w-5 h-5 flex items-center justify-center bg-transparent border-none rounded cursor-pointer p-0 transition-all duration-150 text-[var(--nim-text-muted)] hover:enabled:bg-[var(--nim-bg-hover)] disabled:opacity-50 disabled:cursor-not-allowed';

  return (
    <div className="wakeup-banner px-3 py-2 border-b" style={containerStyle} data-testid="wakeup-banner">
      <div className="wakeup-banner-header flex items-center mb-1.5">
        <span className="text-[11px] font-medium uppercase tracking-wide" style={{ color: accent }}>
          Scheduled
        </span>
      </div>

      <div
        className="wakeup-banner-prompt flex items-center gap-2 px-2 py-1.5 rounded-md border border-[var(--nim-border)] bg-[var(--nim-bg)] text-[13px]"
        data-testid="wakeup-banner-prompt"
        title={statusTooltip(wakeup)}
      >
        <MaterialSymbol icon="schedule_send" size={14} className="shrink-0 text-[var(--nim-text-muted)]" />
        <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[var(--nim-text)]">
          {wakeup.prompt}
        </span>

        {/* Same indicator the queue uses, so an attached image reads the same
            whether the prompt is queued or scheduled. */}
        {wakeup.attachments && wakeup.attachments.length > 0 && (
          <AttachmentIndicator attachments={wakeup.attachments} />
        )}

        <span
          className="wakeup-banner-time shrink-0 text-[11px] font-medium whitespace-nowrap"
          style={{ color: accent }}
          data-testid="wakeup-banner-time"
        >
          {statusLabel(wakeup)}
        </span>

        {(wakeup.status === 'pending' || wakeup.status === 'overdue') && (
          <button
            type="button"
            onClick={handleRunNow}
            disabled={busy}
            className={`${iconButtonClass} hover:enabled:text-[var(--nim-primary)]`}
            data-testid="wakeup-banner-run-now"
            title="Fire this wakeup right now"
            aria-label="Fire now"
          >
            <MaterialSymbol icon="bolt" size={14} />
          </button>
        )}
        <button
          type="button"
          onClick={handleCancel}
          disabled={busy}
          className={`${iconButtonClass} hover:enabled:text-[var(--nim-text)]`}
          data-testid="wakeup-banner-cancel"
          title="Cancel the scheduled wakeup"
          aria-label="Cancel scheduled prompt"
        >
          <MaterialSymbol icon="close" size={14} />
        </button>
      </div>
    </div>
  );
}
