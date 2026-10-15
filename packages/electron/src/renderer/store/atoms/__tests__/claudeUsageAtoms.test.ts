// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { formatResetClock } from '../claudeUsageAtoms';

describe('formatResetClock', () => {
  const now = new Date(2026, 9, 15, 9, 11);
  const time = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  it('shows only the time for a reset later today', () => {
    const reset = new Date(2026, 9, 15, 12, 20);
    expect(formatResetClock(reset.toISOString(), now)).toBe(time(reset));
  });

  it('prefixes the weekday for a reset on a later day', () => {
    const reset = new Date(2026, 9, 18, 19, 30);
    const weekday = reset.toLocaleDateString([], { weekday: 'short' });
    expect(formatResetClock(reset.toISOString(), now)).toBe(`${weekday} ${time(reset)}`);
  });

  it('returns null for missing or past resets', () => {
    expect(formatResetClock(null, now)).toBeNull();
    expect(formatResetClock(new Date(2026, 9, 15, 8, 0).toISOString(), now)).toBeNull();
  });
});
