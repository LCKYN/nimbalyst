// @vitest-environment node
import { describe, it, expect } from 'vitest';

import { formatAxisTokens } from '../ModelComparison';

/**
 * Token counts run into eight digits, which overflowed recharts' 60px default
 * Y axis and were clipped from the left -- every gridline read `000000`.
 */
describe('formatAxisTokens', () => {
  it('abbreviates at each magnitude so a tick fits the axis', () => {
    expect(formatAxisTokens(0)).toBe('0');
    expect(formatAxisTokens(999)).toBe('999');
    expect(formatAxisTokens(1_000)).toBe('1K');
    expect(formatAxisTokens(10_328_471)).toBe('10.3M');
    expect(formatAxisTokens(2_500_000_000)).toBe('2.5B');
  });

  it('drops a trailing .0 rather than implying precision it does not have', () => {
    expect(formatAxisTokens(10_000_000)).toBe('10M');
    expect(formatAxisTokens(5_000)).toBe('5K');
  });

  it('keeps every tick short enough to fit', () => {
    const widest = [999, 1_000, 999_999, 10_328_471, 2_500_000_000, 999_999_999_999]
      .map(formatAxisTokens)
      .reduce((longest, tick) => (tick.length > longest.length ? tick : longest), '');
    expect(widest.length).toBeLessThanOrEqual(6);
  });

  it('renders nothing for a non-finite tick instead of "NaN"', () => {
    expect(formatAxisTokens(Number.NaN)).toBe('');
    expect(formatAxisTokens(Number.POSITIVE_INFINITY)).toBe('');
  });
});
