// @vitest-environment node
import { describe, it, expect } from 'vitest';

import { compareRows, topShare, totalsFor } from '../SessionsBreakdown';

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
