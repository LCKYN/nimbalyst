// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { defaultCustomTime, resolveFireAt } from '../scheduleLater';

const NOW = new Date('2026-09-22T12:00:00.000Z').getTime();

describe('resolveFireAt', () => {
  it('resolves a delay to now + ms', () => {
    expect(resolveFireAt({ kind: 'delay', ms: 3_600_000 }, NOW)).toBe(NOW + 3_600_000);
  });

  it('rejects a delay shorter than the minimum lead time', () => {
    expect(resolveFireAt({ kind: 'delay', ms: 1_000 }, NOW)).toBeNull();
  });

  it('resolves a future clock time to its epoch ms', () => {
    const future = new Date(NOW + 3_600_000).toISOString();
    expect(resolveFireAt({ kind: 'clockTime', isoLocal: future }, NOW)).toBe(NOW + 3_600_000);
  });

  it('rejects a clock time in the past', () => {
    const past = new Date(NOW - 3_600_000).toISOString();
    expect(resolveFireAt({ kind: 'clockTime', isoLocal: past }, NOW)).toBeNull();
  });

  it('rejects an unparseable clock time', () => {
    expect(resolveFireAt({ kind: 'clockTime', isoLocal: 'not-a-date' }, NOW)).toBeNull();
  });

  it('resolves a future usage-reset time to its epoch ms', () => {
    const resetsAt = new Date(NOW + 7_200_000).toISOString();
    expect(resolveFireAt({ kind: 'usageReset', resetsAt }, NOW)).toBe(NOW + 7_200_000);
  });

  it('rejects a usage-reset time already in the past', () => {
    const resetsAt = new Date(NOW - 1_000).toISOString();
    expect(resolveFireAt({ kind: 'usageReset', resetsAt }, NOW)).toBeNull();
  });
});

describe('custom time picker default', () => {
  // The picker value is local wall-clock time. Building it from toISOString()
  // would shift it by the UTC offset, and outside UTC+0 the default would land
  // hours away (or in the past) from what the picker shows.
  it('resolves back to the same instant it was built from, rounded to a quarter hour', () => {
    const fireAt = resolveFireAt({ kind: 'clockTime', isoLocal: defaultCustomTime(NOW) }, NOW);
    expect(fireAt).not.toBeNull();
    expect(fireAt! - NOW).toBeGreaterThanOrEqual(3_600_000);
    expect(fireAt! - NOW).toBeLessThan(3_600_000 + 15 * 60_000);
    expect(new Date(fireAt!).getMinutes() % 15).toBe(0);
  });
});
