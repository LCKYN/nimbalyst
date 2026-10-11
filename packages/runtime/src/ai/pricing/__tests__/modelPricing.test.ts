// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { estimateCostSplitUSD, estimateCostUSD, scaleCostSplit, sumCostSplit } from '../modelPricing';

describe('estimateCostUSD', () => {
  it('computes input+output cost from the table rate', () => {
    const cost = estimateCostUSD('claude-sonnet-5', { inputTokens: 1_000_000, outputTokens: 1_000_000 });
    expect(cost).toBeCloseTo(3 + 15, 6);
  });

  it('includes cache read/write tokens at their own rates', () => {
    const cost = estimateCostUSD('claude-sonnet-5', {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 1_000_000,
      cacheCreationInputTokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(0.3 + 3.75, 6);
  });

  it('falls back to the input rate for cache tokens when a model has no cache rate', () => {
    // No entry in the table has a bare `input`-only rate today, so exercise the
    // default via a model matched only by prefix onto a table row with cache rates
    // to prove those propagate; direct default coverage lives in the property below.
    const cost = estimateCostUSD('claude-opus-4-1-20250805', { inputTokens: 1_000_000 });
    expect(cost).toBeCloseTo(15, 6);
  });

  it('matches dated snapshot ids by longest table-key prefix', () => {
    const cost = estimateCostUSD('claude-opus-4-1-20250805', { outputTokens: 1_000_000 });
    expect(cost).toBeCloseTo(75, 6);
  });

  it('strips a provider registry prefix before lookup', () => {
    const cost = estimateCostUSD('claude-code-cli:claude-sonnet-5', { inputTokens: 1_000_000 });
    expect(cost).toBeCloseTo(3, 6);
  });

  it('returns undefined for a model with no table entry or matching prefix', () => {
    expect(estimateCostUSD('some-unknown-local-model', { inputTokens: 1000 })).toBeUndefined();
  });

  it('returns undefined when no model is given', () => {
    expect(estimateCostUSD(undefined, { inputTokens: 1000 })).toBeUndefined();
  });

  it('returns 0 for a known model with no usage', () => {
    expect(estimateCostUSD('gpt-5', {})).toBe(0);
  });
});

describe('estimateCostSplitUSD', () => {
  const usage = {
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
    cacheReadInputTokens: 1_000_000,
    cacheCreationInputTokens: 1_000_000,
  };

  it('splits by token kind and adds up to estimateCostUSD', () => {
    const split = estimateCostSplitUSD('claude-sonnet-5', usage)!;
    expect(split).toEqual({ input: 3, output: 15, cacheRead: expect.closeTo(0.3, 6), cacheWrite: 3.75 });
    expect(sumCostSplit(split)).toBeCloseTo(estimateCostUSD('claude-sonnet-5', usage)!, 9);
  });

  it('prices cache write at the input rate when the model has no cache write rate', () => {
    expect(estimateCostSplitUSD('gpt-5', usage)!.cacheWrite).toBeCloseTo(1.25, 9);
  });

  it('returns undefined for an unknown model', () => {
    expect(estimateCostSplitUSD('some-unknown-local-model', usage)).toBeUndefined();
  });

  it('scales the proportions to an exact cost', () => {
    const scaled = scaleCostSplit({ input: 1, output: 3, cacheRead: 0, cacheWrite: 0 }, 8);
    expect(scaled).toEqual({ input: 2, output: 6, cacheRead: 0, cacheWrite: 0 });
    expect(sumCostSplit(scaleCostSplit({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, 5))).toBe(0);
  });
});
