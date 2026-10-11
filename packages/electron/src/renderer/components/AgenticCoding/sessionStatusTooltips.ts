import type { SessionWakeupView } from '../../store/atoms/sessions';

// Shared by top-level session rows and workstream child rows so both explain
// the clock and (!) markers the same way.

// A session can hold several schedules; the tooltip describes the soonest and
// says how many more are behind it rather than hiding them.
export function wakeupTooltip(wakeups: SessionWakeupView[]): string {
  const wakeup = wakeups[0];
  const more = wakeups.length > 1 ? ` (+${wakeups.length - 1} more)` : '';
  const reason = wakeup.reason ? ` — ${wakeup.reason}` : '';
  return wakeup.status === 'overdue'
    ? `Overdue wakeup${reason}${more}`
    : `Scheduled wakeup at ${new Date(wakeup.fireAt).toLocaleString()}${reason}${more}`;
}

export function errorNoticeTooltip(notice: { kind: 'usage_limit' | 'network' | 'error'; message: string; resetsAt?: number }): string {
  const title = notice.kind === 'usage_limit'
    ? 'Usage limit reached'
    : notice.kind === 'network' ? 'Connection lost' : 'Agent stopped with an error';
  const resets = notice.resetsAt
    ? ` (resets ${new Date(notice.resetsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })})`
    : '';
  return `${title}: ${notice.message}${resets}`;
}
