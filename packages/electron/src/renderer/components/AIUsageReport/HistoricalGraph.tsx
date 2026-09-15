import React, { useEffect, useState } from 'react';
import { SectionHeading } from './ReportControls';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface HistoricalGraphProps {
  workspaceId?: string;
  sinceMs?: number;
}

interface TimeSeriesDataPoint {
  timestamp: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  sessionCount: number;
}

export const HistoricalGraph: React.FC<HistoricalGraphProps> = ({ workspaceId, sinceMs }) => {
  const [data, setData] = useState<TimeSeriesDataPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        const now = Date.now();
        // The report's shared range decides the window. "All time" has no lower
        // bound, so fall back to a year rather than querying from the epoch.
        const startDate = sinceMs ?? now - 365 * 24 * 60 * 60 * 1000;

        const timeSeries = await window.electronAPI.invoke(
          'usage-analytics:get-time-series',
          startDate,
          now,
          'day',
          workspaceId
        );
        setData(timeSeries);
      } catch (error) {
        console.error('Failed to load time series data:', error);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [workspaceId, sinceMs]);

  if (loading) {
    return <div className="historical-graph-loading flex items-center justify-center min-h-[400px] text-nim-muted text-base">Loading...</div>;
  }

  const chartData = data.map((point) => ({
    // Use UTC date formatting since timestamps are truncated to UTC midnight
    date: new Date(point.timestamp).toLocaleDateString(undefined, { timeZone: 'UTC' }),
    'Input Tokens': point.inputTokens,
    'Output Tokens': point.outputTokens,
    Sessions: point.sessionCount,
  }));

  return (
    <div className="historical-graph flex flex-col gap-6">
      <SectionHeading>Token Usage Over Time</SectionHeading>

      {chartData.length > 0 ? (
        <ResponsiveContainer width="100%" height={400}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--nim-border)" />
            <XAxis dataKey="date" stroke="var(--nim-text-muted)" />
            <YAxis stroke="var(--nim-text-muted)" />
            <Tooltip
              contentStyle={{
                background: 'var(--nim-bg-secondary)',
                border: '1px solid var(--nim-border)',
                borderRadius: '6px',
                color: 'var(--nim-text)',
              }}
            />
            <Legend />
            {/* Were recharts' stock #8884d8 / #82ca9d -- not Nimbalyst colours,
                and fixed regardless of theme. */}
            <Line type="monotone" dataKey="Input Tokens" stroke="var(--nim-primary)" strokeWidth={2} />
            <Line type="monotone" dataKey="Output Tokens" stroke="var(--nim-success)" strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <div className="no-data flex items-center justify-center min-h-[400px] text-nim-muted text-base">No data available for this time range</div>
      )}
    </div>
  );
};
