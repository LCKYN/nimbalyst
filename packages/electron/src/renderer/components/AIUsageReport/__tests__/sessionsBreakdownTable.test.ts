// @vitest-environment node
import { describe, it, expect } from 'vitest';

import { compareRows, totalsFor } from '../SessionsBreakdown';

type Row = Parameters<typeof totalsFor>[0][number];

const NOW = Date.UTC(2026, 8, 14);

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: 'session-1',
    title: 'A session',
    provider: 'claude-code',
    model: 'opus',
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

    const opus = row({ provider: 'claude-code', model: 'opus' });
    const sonnet = row({ provider: 'claude-code', model: 'sonnet' });
    expect(compareRows(opus, sonnet, { key: 'model', direction: 'asc' })).toBeLessThan(0);
  });

  it('sorts by the column asked for, not the one the server happened to order by', () => {
    const rows = [
      row({ id: 'a', inputTokens: 5, costUSD: 100 }),
      row({ id: 'b', inputTokens: 50, costUSD: 1 }),
    ];
    const byInput = [...rows].sort((x, y) => compareRows(x, y, { key: 'inputTokens', direction: 'desc' }));
    expect(byInput.map((r) => r.id)).toEqual(['b', 'a']);
  });
});
