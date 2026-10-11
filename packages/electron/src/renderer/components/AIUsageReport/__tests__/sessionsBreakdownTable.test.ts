// @vitest-environment node
import { describe, it, expect } from 'vitest';

import { cacheHitRate, compareRows, filterByTitle, topShare, totalsFor } from '../SessionsBreakdown';

type Row = Parameters<typeof totalsFor>[0][number];

const NOW = Date.UTC(2026, 8, 14);

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: 'session-1',
    title: 'A session',
    provider: 'claude-code',
    model: 'opus',
    modelLabel: 'opus',
    workstreamTitle: 'A session',
    rangeShare: 1,
    lastActiveAt: NOW,
    parentSessionId: null,
    createdBySessionId: null,
    workstreamRootId: 'session-1',
    inputTokens: 100,
    outputTokens: 10,
    totalTokens: 110,
    costUSD: 1,
    costEstimated: false,
    cacheReadInputTokens: 5,
    cacheCreationInputTokens: 2,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as Row;
}

describe('totalsFor', () => {
  it('sums every numeric column', () => {
    const totals = totalsFor([
      row({ inputTokens: 100, outputTokens: 10, totalTokens: 110, costUSD: 1.5, cacheReadInputTokens: 5, cacheCreationInputTokens: 2 }),
      row({ inputTokens: 200, outputTokens: 20, totalTokens: 220, costUSD: 2.25, cacheReadInputTokens: 7, cacheCreationInputTokens: 3 }),
    ]);

    expect(totals.inputTokens).toBe(300);
    expect(totals.outputTokens).toBe(30);
    expect(totals.totalTokens).toBe(330);
    expect(totals.costUSD).toBe(3.75);
    expect(totals.cacheReadInputTokens).toBe(12);
    expect(totals.cacheCreationInputTokens).toBe(5);
  });

  // Presenting a total as exact when one contributing row was estimated from
  // published pricing would overstate what we actually know.
  it('marks the total estimated when any single row was estimated', () => {
    expect(totalsFor([row({ costEstimated: false }), row({ costEstimated: true })]).costEstimated).toBe(true);
    expect(totalsFor([row({ costEstimated: false })]).costEstimated).toBe(false);
  });

  it('sums the cost splits of the rows that have one', () => {
    const split = { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 };
    expect(totalsFor([row({ costSplit: split }), row(), row({ costSplit: split })]).costSplit)
      .toEqual({ input: 2, output: 4, cacheRead: 6, cacheWrite: 8 });
    expect(totalsFor([row()]).costSplit).toBeUndefined();
  });

  it('totals an empty set to zero rather than NaN', () => {
    expect(totalsFor([])).toMatchObject({ inputTokens: 0, totalTokens: 0, costUSD: 0, costEstimated: false });
  });
});

describe('compareRows', () => {
  it('orders numeric columns in the requested direction', () => {
    const cheap = row({ costUSD: 1 });
    const dear = row({ costUSD: 9 });

    expect(compareRows(cheap, dear, { key: 'costUSD', direction: 'desc' })).toBeGreaterThan(0);
    expect(compareRows(cheap, dear, { key: 'costUSD', direction: 'asc' })).toBeLessThan(0);
  });

  it('sorts the session and model columns as text', () => {
    const alpha = row({ title: 'Alpha' });
    const zulu = row({ title: 'Zulu' });
    expect(compareRows(alpha, zulu, { key: 'title', direction: 'asc' })).toBeLessThan(0);

    const opus = row({ modelLabel: 'opus' });
    const sonnet = row({ modelLabel: 'sonnet' });
    expect(compareRows(opus, sonnet, { key: 'model', direction: 'asc' })).toBeLessThan(0);
  });

  it('sorts by the column asked for, not the one the server happened to order by', () => {
    const rows = [
      row({ id: 'a', totalTokens: 5, costUSD: 100 }),
      row({ id: 'b', totalTokens: 50, costUSD: 1 }),
    ];
    const byTokens = [...rows].sort((x, y) => compareRows(x, y, { key: 'totalTokens', direction: 'desc' }));
    expect(byTokens.map((r) => r.id)).toEqual(['b', 'a']);
  });
});

describe('cacheHitRate', () => {
  it('is cache reads over all prompt input, including cache writes', () => {
    expect(cacheHitRate(row({ inputTokens: 10, cacheReadInputTokens: 80, cacheCreationInputTokens: 10 }))).toBeCloseTo(0.8);
  });

  it('is null, not 0%, when there was no prompt input', () => {
    expect(cacheHitRate(row({ inputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 }))).toBeNull();
  });

  it('sorts sessions with no input below a real 0% hit rate', () => {
    const none = row({ id: 'none', inputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 });
    const zero = row({ id: 'zero', inputTokens: 50, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 });
    const high = row({ id: 'high', inputTokens: 1, cacheReadInputTokens: 99, cacheCreationInputTokens: 0 });
    const sorted = [none, zero, high].sort((x, y) => compareRows(x, y, { key: 'cacheHit', direction: 'desc' }));
    expect(sorted.map((r) => r.id)).toEqual(['high', 'zero', 'none']);
  });
});

describe('topShare', () => {
  it('measures how much of the spend the costliest sessions hold, whatever order they arrive in', () => {
    const rows = [row({ costUSD: 1 }), row({ costUSD: 6 }), row({ costUSD: 3 })];
    expect(topShare(rows, 1)).toBeCloseTo(0.6);
    expect(topShare(rows, 5)).toBe(1);
  });

  it('is zero rather than NaN when nothing was spent', () => {
    expect(topShare([row({ costUSD: 0 })], 3)).toBe(0);
  });
});

describe('filterByTitle', () => {
  const rows = [row({ id: 'a', title: 'Dark mode implementation' }), row({ id: 'b', title: 'Fix sync bug' })];

  it('matches a title substring regardless of case and surrounding spaces', () => {
    expect(filterByTitle(rows, '  DARK ').map((r) => r.id)).toEqual(['a']);
  });

  it('keeps every row for a blank query', () => {
    expect(filterByTitle(rows, '   ')).toHaveLength(2);
  });
});
