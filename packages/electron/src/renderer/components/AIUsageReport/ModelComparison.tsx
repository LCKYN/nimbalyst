import React, { useEffect, useState } from 'react';
import { SectionHeading } from './ReportControls';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface ModelComparisonProps {
  workspaceId?: string;
  sinceMs?: number;
}

interface ProviderUsageStats {
  provider: string;
  model: string | null;
  sessionCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
}

/**
 * Axis ticks only. Recharts gives the Y axis 60px by default, and a raw token
 * count like `10328471` is wider than that, so it was being clipped from the
 * left -- the axis read `000000` at every gridline. The tooltip still shows the
 * exact figure, so nothing is lost by abbreviating here.
 */
export function formatAxisTokens(value: number): string {
  if (!Number.isFinite(value)) return '';
  const abs = Math.abs(value);
  const scaled =
    abs >= 1_000_000_000 ? { n: value / 1_000_000_000, suffix: 'B' }
    : abs >= 1_000_000 ? { n: value / 1_000_000, suffix: 'M' }
    : abs >= 1_000 ? { n: value / 1_000, suffix: 'K' }
    : { n: value, suffix: '' };
  if (!scaled.suffix) return String(value);
  // `10.0M` reads as false precision; `10M` is the same number.
  return `${scaled.n.toFixed(1).replace(/\.0$/, '')}${scaled.suffix}`;
}

export const ModelComparison: React.FC<ModelComparisonProps> = ({ workspaceId, sinceMs }) => {
  const [data, setData] = useState<ProviderUsageStats[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        const providers = await window.electronAPI.invoke('usage-analytics:get-usage-by-provider', workspaceId, sinceMs);
        setData(providers);
      } catch (error) {
        console.error('Failed to load model comparison data:', error);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [workspaceId, sinceMs]);

  if (loading) {
    return (
      <div className="model-comparison-loading flex items-center justify-center min-h-[400px] text-base text-nim-muted">
        Loading...
      </div>
    );
  }

  const chartData = data.map((item) => ({
    // The provider prefix repeats in every label ("claude-code (claude-code:opus-1m)"),
    // which made the labels wide enough that recharts dropped half of them. The
    // model alone identifies the bar; the tooltip still carries the full name.
    name: item.model ? item.model.replace(/^claude-code:/, '') : item.provider,
    fullName: `${item.provider}${item.model ? ` (${item.model})` : ''}`,
    'Total Tokens': item.totalTokens,
    Sessions: item.sessionCount,
  }));

  return (
    <div className="model-comparison flex flex-col gap-6">
      <SectionHeading>Usage by Model</SectionHeading>

      {chartData.length > 0 ? (
        <ResponsiveContainer width="100%" height={400}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--nim-border)" />
            <XAxis dataKey="name" stroke="var(--nim-text-muted)" interval={0} tick={{ fontSize: 11 }} />
            <YAxis stroke="var(--nim-text-muted)" width={72} tickFormatter={formatAxisTokens} />
            <Tooltip
              formatter={(value) => (typeof value === 'number' ? value.toLocaleString() : String(value))}
              labelFormatter={(_label, payload) =>
                (payload?.[0]?.payload as { fullName?: string } | undefined)?.fullName ?? String(_label)
              }
              contentStyle={{
                background: 'var(--nim-bg-secondary)',
                border: '1px solid var(--nim-border)',
                borderRadius: '6px',
                color: 'var(--nim-text)',
              }}
            />
            <Legend />
            <Bar dataKey="Total Tokens" fill="var(--nim-primary)" />
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <div className="no-data flex items-center justify-center min-h-[400px] text-base text-nim-muted">
          No model usage data available
        </div>
      )}
    </div>
  );
};
