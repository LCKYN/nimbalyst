/**
 * Pure time-resolution for the "Run later" prompt scheduler. No React, no IPC —
 * kept separate from ScheduleLaterMenu.tsx so the date math is unit-testable
 * without rendering.
 */

export type ScheduleLaterMode =
  | { kind: 'delay'; ms: number }
  | { kind: 'clockTime'; isoLocal: string }
  | { kind: 'usageReset'; resetsAt: string };

const MIN_LEAD_MS = 30_000;

/**
 * Resolves a schedule mode to an epoch-ms fire time. Returns null when the
 * mode can't produce a valid future time (unparseable date, or a time that's
 * already passed) so the caller can disable submission instead of scheduling
 * something that fires immediately.
 */
export function resolveFireAt(mode: ScheduleLaterMode, now: number = Date.now()): number | null {
  switch (mode.kind) {
    case 'delay': {
      if (!Number.isFinite(mode.ms) || mode.ms < MIN_LEAD_MS) return null;
      return now + mode.ms;
    }
    case 'clockTime': {
      const parsed = new Date(mode.isoLocal).getTime();
      if (!Number.isFinite(parsed) || Number.isNaN(parsed)) return null;
      if (parsed < now + MIN_LEAD_MS) return null;
      return parsed;
    }
    case 'usageReset': {
      const parsed = new Date(mode.resetsAt).getTime();
      if (!Number.isFinite(parsed) || Number.isNaN(parsed)) return null;
      if (parsed < now + MIN_LEAD_MS) return null;
      return parsed;
    }
    default:
      return null;
  }
}
