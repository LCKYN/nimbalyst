/**
 * Fallback cost-estimation table for providers whose SDK/API response doesn't
 * carry an exact `costUSD` (e.g. `openai`, `claude-code-cli`'s proxy observation
 * path). This is intentionally a small, hand-maintained table -- not a source
 * of truth for billing, just enough to show a `~$` figure in the usage
 * dashboard. Callers must mark any cost derived from this table as
 * `costEstimated: true` so the UI can distinguish it from an SDK-exact figure.
 *
 * Rates are USD per 1,000,000 tokens, keyed by the model's own id (not the
 * `provider:model` registry id -- callers strip the `provider:` prefix before
 * lookup). `cacheRead`/`cacheWrite` default to the `input` rate when a
 * provider doesn't publish a separate cache rate.
 */

export interface ModelPriceRatePerMillion {
  input: number;
  output: number;
  /** Defaults to `input` when omitted. */
  cacheRead?: number;
  /** Defaults to `input` when omitted. */
  cacheWrite?: number;
}

export const MODEL_PRICING_PER_MILLION_TOKENS: Record<string, ModelPriceRatePerMillion> = {
  // Anthropic Claude (also covers claude-code / claude-code-cli, which run these models)
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-opus-4-7': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-opus-4-6': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-opus-4-5': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-opus-4-1': { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  'claude-opus-4': { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  'claude-sonnet-5': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-sonnet-4-5': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-sonnet-4': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-3-7-sonnet': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-fable-5-1': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-fable-5': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },

  // OpenAI
  'gpt-5.6': { input: 1.25, output: 10, cacheRead: 0.125 },
  'gpt-5.5': { input: 1.25, output: 10, cacheRead: 0.125 },
  'gpt-5.4': { input: 1.25, output: 10, cacheRead: 0.125 },
  'gpt-5.3': { input: 1.25, output: 10, cacheRead: 0.125 },
  'gpt-5.2': { input: 1.25, output: 10, cacheRead: 0.125 },
  'gpt-5.1': { input: 1.25, output: 10, cacheRead: 0.125 },
  'gpt-5-nano': { input: 0.05, output: 0.4, cacheRead: 0.005 },
  'gpt-5-mini': { input: 0.25, output: 2, cacheRead: 0.025 },
  'gpt-5': { input: 1.25, output: 10, cacheRead: 0.125 },
  'gpt-4.1-nano': { input: 0.1, output: 0.4, cacheRead: 0.025 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6, cacheRead: 0.1 },
  'gpt-4.1': { input: 2, output: 8, cacheRead: 0.5 },
  'gpt-4o-mini': { input: 0.15, output: 0.6, cacheRead: 0.075 },
  'gpt-4o': { input: 2.5, output: 10, cacheRead: 1.25 },
};

export interface EstimateCostUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}

/** Strip a `provider:` registry prefix (`claude-code-cli:opus` -> `opus`) before rate lookup. */
function stripRegistryPrefix(model: string): string {
  const colonIndex = model.indexOf(':');
  return colonIndex === -1 ? model : model.slice(colonIndex + 1);
}

/**
 * Look up a model's rate, falling back to the longest matching table key that
 * the (lowercased, prefix-stripped) model id starts with -- covers dated
 * snapshot ids like `claude-opus-4-1-20250805` or `gpt-4o-2024-08-06` without
 * a table row per snapshot.
 */
function findRate(model: string): ModelPriceRatePerMillion | undefined {
  const normalized = stripRegistryPrefix(model).toLowerCase();
  const exact = MODEL_PRICING_PER_MILLION_TOKENS[normalized];
  if (exact) return exact;

  let bestKey: string | undefined;
  for (const key of Object.keys(MODEL_PRICING_PER_MILLION_TOKENS)) {
    if (normalized.startsWith(key) && (!bestKey || key.length > bestKey.length)) {
      bestKey = key;
    }
  }
  return bestKey ? MODEL_PRICING_PER_MILLION_TOKENS[bestKey] : undefined;
}

/** What a cost is made of, by token kind, in USD. */
export interface CostSplitUSD {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/**
 * Estimate cost in USD per token kind from published per-million-token rates.
 * Returns `undefined` when the model isn't in the table (and has no matching
 * prefix).
 */
export function estimateCostSplitUSD(model: string | undefined, usage: EstimateCostUsage): CostSplitUSD | undefined {
  if (!model) return undefined;
  const rate = findRate(model);
  if (!rate) return undefined;

  return {
    input: ((usage.inputTokens ?? 0) * rate.input) / 1_000_000,
    output: ((usage.outputTokens ?? 0) * rate.output) / 1_000_000,
    cacheRead: ((usage.cacheReadInputTokens ?? 0) * (rate.cacheRead ?? rate.input)) / 1_000_000,
    cacheWrite: ((usage.cacheCreationInputTokens ?? 0) * (rate.cacheWrite ?? rate.input)) / 1_000_000,
  };
}

export function sumCostSplit(split: CostSplitUSD): number {
  return split.input + split.output + split.cacheRead + split.cacheWrite;
}

/**
 * Scale a split so it adds up to `costUSD` -- an SDK-exact cost keeps the
 * authority and the estimated split only supplies the proportions. A split that
 * sums to zero stays zero.
 */
export function scaleCostSplit(split: CostSplitUSD, costUSD: number): CostSplitUSD {
  const sum = sumCostSplit(split);
  const factor = sum > 0 ? costUSD / sum : 0;
  return {
    input: split.input * factor,
    output: split.output * factor,
    cacheRead: split.cacheRead * factor,
    cacheWrite: split.cacheWrite * factor,
  };
}

/**
 * Estimate cost in USD from published per-million-token rates. Returns
 * `undefined` when the model isn't in the table (and has no matching prefix)
 * -- callers should leave `costUSD` unset in that case rather than showing a
 * fabricated `$0.00`.
 */
export function estimateCostUSD(model: string | undefined, usage: EstimateCostUsage): number | undefined {
  const split = estimateCostSplitUSD(model, usage);
  return split ? sumCostSplit(split) : undefined;
}
