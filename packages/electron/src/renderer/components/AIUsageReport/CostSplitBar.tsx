import React from 'react';
import type { CostSplitUSD } from '@nimbalyst/runtime/ai/pricing/modelPricing';
import { formatCompactNumber, formatUSD } from './usageFormat';

export type CostSplitTokens = Record<keyof CostSplitUSD, number>;

/**
 * Fixed colors, no theme variables of their own. Cache read is cheap so it stays
 * quiet; cache write shares `warning` with the "cache likely expired" badge on
 * purpose -- they are the same story.
 */
export const COST_SPLIT_KINDS: ReadonlyArray<{ key: keyof CostSplitUSD; label: string; color: string }> = [
  { key: 'input', label: 'In', color: 'var(--nim-info)' },
  { key: 'output', label: 'Out', color: 'var(--nim-primary)' },
  { key: 'cacheRead', label: 'Cache read', color: 'var(--nim-text-faint)' },
  { key: 'cacheWrite', label: 'Cache write', color: 'var(--nim-warning)' },
];

/** One line per kind: `Cache read 35% · $1.20 · 2.4M tokens`. */
export function costSplitTooltip(split: CostSplitUSD, tokens: CostSplitTokens | undefined, estimated: boolean): string {
  const total = split.input + split.output + split.cacheRead + split.cacheWrite;
  return COST_SPLIT_KINDS.map(({ key, label }) => {
    const parts = [
      `${label} ${total > 0 ? Math.round((split[key] / total) * 100) : 0}%`,
      `${estimated ? '~' : ''}${formatUSD(split[key])}`,
    ];
    if (tokens) parts.push(`${formatCompactNumber(tokens[key])} tokens`);
    return parts.join(' · ');
  }).join('\n');
}

/**
 * What a cost is made of. The bar fills `width`% of its track; the fill is the
 * four kinds in proportion. One tooltip for the whole bar -- a 6px segment is
 * too small to hover.
 */
export const CostSplitBar: React.FC<{
  split: CostSplitUSD;
  tokens?: CostSplitTokens;
  width?: number;
  estimated?: boolean;
  className?: string;
}> = ({ split, tokens, width = 100, estimated = false, className = '' }) => {
  const total = split.input + split.output + split.cacheRead + split.cacheWrite;
  const tooltip = costSplitTooltip(split, tokens, estimated);
  return (
    <div
      className={`cost-split-bar h-1.5 bg-[var(--nim-bg-tertiary)] rounded-sm overflow-hidden ${className}`}
      title={tooltip}
      aria-label={tooltip}
      role="img"
    >
      <div className="flex h-full rounded-sm overflow-hidden" style={{ width: `${width}%` }}>
        {total > 0 &&
          COST_SPLIT_KINDS.map(({ key, color }) => (
            <div key={key} className="h-full" style={{ width: `${(split[key] / total) * 100}%`, background: color }} />
          ))}
      </div>
    </div>
  );
};

export const CostSplitSwatch: React.FC<{ color: string }> = ({ color }) => (
  <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: color }} aria-hidden="true" />
);

export const CostSplitLegend: React.FC = () => (
  <div className="cost-split-legend flex items-center gap-3 text-[11px] text-nim-muted">
    {COST_SPLIT_KINDS.map(({ key, label, color }) => (
      <span key={key} className="flex items-center gap-1">
        <CostSplitSwatch color={color} />
        {label}
      </span>
    ))}
  </div>
);
