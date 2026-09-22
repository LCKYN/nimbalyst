import React, { useEffect, useState } from 'react';
import { useAtomValue } from 'jotai';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import { FloatingPortal, useFloatingMenu } from '../../hooks/useFloatingMenu';
import { claudeUsageAtom, formatResetTime } from '../../store/atoms/claudeUsageAtoms';
import { resolveFireAt, type ScheduleLaterMode } from './scheduleLater';

interface DelayPreset {
  label: string;
  ms: number;
}

const DELAY_PRESETS: DelayPreset[] = [
  { label: 'In 1 hour', ms: 60 * 60_000 },
  { label: 'In 4 hours', ms: 4 * 60 * 60_000 },
];

// "Tomorrow, 9am" is a wall-clock target, not a fixed duration, so it's resolved
// to an ISO string at click time (below) rather than baked into DELAY_PRESETS —
// a module-level ms delta would go stale for the lifetime of the renderer.
function tomorrowNineAmIso(): string {
  const target = new Date();
  target.setDate(target.getDate() + 1);
  target.setHours(9, 0, 0, 0);
  return target.toISOString();
}

interface ScheduleLaterMenuProps {
  disabled?: boolean;
  /** Shown as the tooltip when disabled, so the reason isn't a mystery. */
  disabledReason?: string;
  /** Called with the resolved epoch-ms fire time once the user confirms an option. */
  onSchedule: (fireAt: number) => void;
}

export function ScheduleLaterMenu({ disabled = false, disabledReason, onSchedule }: ScheduleLaterMenuProps) {
  const menu = useFloatingMenu({ placement: 'top-end', offsetPx: 6 });
  const { isOpen, setIsOpen } = menu;
  const usage = useAtomValue(claudeUsageAtom);
  const [customTime, setCustomTime] = useState('');
  const [error, setError] = useState<string | null>(null);

  const resetsAt = usage?.fiveHour.resetsAt ?? null;
  const usageResetAvailable = resetsAt !== null && resolveFireAt({ kind: 'usageReset', resetsAt }) !== null;

  // Dismissing the menu (click-outside or Escape) bypasses every handler, so
  // without this a failed attempt greets the user again on reopen.
  useEffect(() => {
    if (!isOpen) setError(null);
  }, [isOpen]);

  /**
   * Every path routes through here so an unresolvable time reports itself.
   * A menu that just closes (or does nothing) on an already-passed usage reset
   * is indistinguishable from a successful schedule.
   */
  const confirm = (mode: ScheduleLaterMode, failureMessage: string) => {
    const fireAt = resolveFireAt(mode);
    if (fireAt === null) {
      setError(failureMessage);
      return;
    }
    onSchedule(fireAt);
    setIsOpen(false);
    setCustomTime('');
    setError(null);
  };

  return (
    <div className="schedule-later-menu relative inline-block">
      <button
        ref={menu.refs.setReference}
        {...menu.getReferenceProps()}
        type="button"
        data-testid="schedule-later-trigger"
        className="w-9 h-9 flex items-center justify-center bg-transparent border border-[var(--nim-border)] rounded-md text-[var(--nim-text-muted)] cursor-pointer transition-all duration-200 shrink-0 hover:enabled:bg-[var(--nim-bg-hover)] disabled:opacity-40 disabled:cursor-not-allowed"
        onClick={() => {
          if (!disabled) setIsOpen(!isOpen);
        }}
        disabled={disabled}
        title={disabled && disabledReason ? disabledReason : 'Run later'}
        aria-label="Run later"
      >
        <MaterialSymbol icon="schedule" size={16} />
      </button>

      {isOpen && (
        <FloatingPortal>
          <div
            ref={menu.refs.setFloating}
            style={menu.floatingStyles}
            {...menu.getFloatingProps()}
            className="schedule-later-menu-panel min-w-[220px] rounded-lg p-2 z-[1000] bg-[var(--nim-bg)] border border-[var(--nim-border)] shadow-[0_4px_12px_rgba(0,0,0,0.15)]"
          >
            {DELAY_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                className="flex items-center w-full px-2 py-1.5 border-none rounded text-xs text-left cursor-pointer text-[var(--nim-text)] hover:bg-[var(--nim-bg-hover)]"
                onClick={() => confirm({ kind: 'delay', ms: preset.ms }, 'That delay is too short to schedule.')}
              >
                {preset.label}
              </button>
            ))}

            <button
              type="button"
              className="flex items-center w-full px-2 py-1.5 border-none rounded text-xs text-left cursor-pointer text-[var(--nim-text)] hover:bg-[var(--nim-bg-hover)]"
              onClick={() =>
                confirm({ kind: 'clockTime', isoLocal: tomorrowNineAmIso() }, 'That time has already passed.')
              }
            >
              Tomorrow, 9am
            </button>

            <button
              type="button"
              data-testid="schedule-later-usage-reset"
              disabled={!usageResetAvailable}
              className="flex items-center w-full px-2 py-1.5 border-none rounded text-xs text-left cursor-pointer text-[var(--nim-text)] hover:enabled:bg-[var(--nim-bg-hover)] disabled:opacity-40 disabled:cursor-not-allowed"
              title={usageResetAvailable ? undefined : 'No usage data yet'}
              onClick={() =>
                resetsAt &&
                confirm({ kind: 'usageReset', resetsAt }, 'Your usage has already reset — send it now instead.')
              }
            >
              When my usage resets{resetsAt ? ` (${formatResetTime(resetsAt)})` : ''}
            </button>

            <div className="flex items-center gap-1 px-2 py-1.5">
              <input
                type="datetime-local"
                data-testid="schedule-later-custom-time"
                value={customTime}
                onChange={(e) => {
                  setCustomTime(e.target.value);
                  setError(null);
                }}
                className="flex-1 min-w-0 px-1 py-0.5 rounded border border-[var(--nim-border)] bg-transparent text-xs text-[var(--nim-text)]"
              />
              <button
                type="button"
                disabled={!customTime}
                className="px-2 py-0.5 rounded text-xs border-none cursor-pointer bg-[var(--nim-primary)] text-white disabled:opacity-40 disabled:cursor-not-allowed"
                onClick={() =>
                  confirm(
                    { kind: 'clockTime', isoLocal: customTime },
                    'Pick a time at least 30 seconds from now.',
                  )
                }
              >
                Set
              </button>
            </div>
            {error && (
              <p data-testid="schedule-later-error" className="px-2 pb-1 text-[11px] text-[var(--nim-error)]">
                {error}
              </p>
            )}
          </div>
        </FloatingPortal>
      )}
    </div>
  );
}
