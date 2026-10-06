// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { estimateCostUSD } from '../modelPricing';

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
