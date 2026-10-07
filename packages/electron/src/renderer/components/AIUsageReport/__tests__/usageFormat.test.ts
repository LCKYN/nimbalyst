// @vitest-environment node
import { describe, it, expect } from 'vitest';

import { fillDailyCounts, formatCompactNumber, formatCompactUSD, formatUSD } from '../usageFormat';

describe('fillDailyCounts', () => {
  const now = Date.parse('2026-07-05T12:00:00Z');

  it('zero-fills from the range start to today so quiet days show as empty bars', () => {
    const { granularity, buckets } = fillDailyCounts(
      [{ day: '2026-07-02', count: 4 }],
      { sinceMs: Date.parse('2026-07-01T08:00:00Z'), nowMs: now },
    );
    expect(granularity).toBe('day');
    expect(buckets).toEqual([
      { day: '2026-07-01', count: 0 },
      { day: '2026-07-02', count: 4 },
      { day: '2026-07-03', count: 0 },
      { day: '2026-07-04', count: 0 },
      { day: '2026-07-05', count: 0 },
    ]);
  });

  it('rolls a long span into Monday-start weeks without losing counts', () => {
    const { granularity, buckets } = fillDailyCounts(
      [{ day: '2026-01-01', count: 2 }, { day: '2026-07-01', count: 3 }, { day: '2026-07-03', count: 1 }],
      { nowMs: now },
    );
    expect(granularity).toBe('week');
    expect(buckets[0].day).toBe('2025-12-29');
    expect(buckets.find((b) => b.day === '2026-06-29')!.count).toBe(4);
    expect(buckets.reduce((sum, b) => sum + b.count, 0)).toBe(6);
  });
});

/**
 * Token counts run into eight digits, which overflowed recharts' 60px default
 * Y axis and were clipped from the left -- `2400000` read as `400000`.
 */
describe('formatCompactNumber', () => {
  it('abbreviates at each magnitude so a tick fits the axis', () => {
    expect(formatCompactNumber(0)).toBe('0');
    expect(formatCompactNumber(999)).toBe('999');
    expect(formatCompactNumber(1_000)).toBe('1K');
    expect(formatCompactNumber(10_328_471)).toBe('10.3M');
    expect(formatCompactNumber(2_400_000)).toBe('2.4M');
    expect(formatCompactNumber(1_250_000_000)).toBe('1.3B');
  });

  it('never renders a fractional token count', () => {
    expect(formatCompactNumber(412.6)).toBe('413');
  });
});

describe('formatUSD', () => {
  it('keeps cents only where they matter and never shows a tiny spend as $0.00', () => {
    expect(formatUSD(0)).toBe('$0');
    expect(formatUSD(0.004)).toBe('<$0.01');
    expect(formatUSD(12.345)).toBe('$12.35');
    expect(formatUSD(1234.5)).toBe('$1,235');
  });

  it('compacts axis ticks without dropping sub-dollar precision', () => {
    expect(formatCompactUSD(0.5)).toBe('$0.50');
    expect(formatCompactUSD(2.5)).toBe('$2.5');
    expect(formatCompactUSD(1_200)).toBe('$1.2K');
  });
});
