import React, { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { CHART_TOOLTIP_STYLE, RankedBars, ReportSection, StatCard, StatGrid } from './ReportControls';
import { calendarWeeks, formatCompactNumber, formatCompactUSD, formatUSD, type CalendarDay } from './usageFormat';

interface UsageSlice {
  costUSD: number;
  totalTokens: number;
  sessionCount: number;
  costEstimated: boolean;
}

/** Mirrors `UsageOverview` in main/services/usageOverview.ts. */
export interface UsageOverviewData {
  totals: {
    costUSD: number;
    inputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    outputTokens: number;
    totalTokens: number;
    costEstimated: boolean;
    unpricedSessionCount: number;
    sessionCount: number;
    projectCount: number;
    activeDays: number;
  };
  granularity: 'day' | 'week';
  trend: Array<{ startMs: number; costUSD: number; totalTokens: number }>;
  daily: CalendarDay[];
  byModel: Array<UsageSlice & { model: string }>;
  byProject: Array<UsageSlice & { workspaceId: string; lastActiveMs: number }>;
}

/**
 * The whole page reads in one measure. Spend is the question the Overview
 * answers; it falls back to tokens only when nothing in range could be priced,
 * and then every panel falls back together.
 */
type Measure = 'cost' | 'tokens';

function plural(n: number, word: string): string {
  return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
}

const WEEKDAY_LABELS = ['', 'Mon', '', 'Wed', '', 'Fri', ''];
// Labels read from a day's noon: its start is midnight at today's UTC offset,
// which lands in the previous evening on the far side of a DST change.
const HALF_DAY_MS = 12 * 60 * 60 * 1000;

const SpendCalendar: React.FC<{ daily: CalendarDay[]; sinceMs?: number; measure: Measure }> = ({
  daily,
  sinceMs,
  measure,
}) => {
  const weeks = calendarWeeks(daily, {
    sinceMs,
    nowMs: Date.now(),
    timezoneOffsetMinutes: new Date().getTimezoneOffset(),
  });
  const valueOf = (day: CalendarDay) => (measure === 'cost' ? day.costUSD : day.totalTokens);
  const max = Math.max(0, ...daily.map(valueOf));

  return (
    <div className="spend-calendar overflow-x-auto">
      <div className="spend-calendar-grid inline-flex flex-col gap-2 text-[10px] text-[var(--nim-text-muted)]">
        <div className="flex gap-[3px]">
          <div className="spend-calendar-weekdays flex flex-col gap-[3px] pr-1">
            <div className="h-3" />
            {WEEKDAY_LABELS.map((label, i) => (
              <div key={i} className="h-3 leading-3">{label}</div>
            ))}
          </div>
          {weeks.map((week, weekIndex) => {
            const dateOf = (day: CalendarDay) => new Date(day.startMs + HALF_DAY_MS).getDate();
            const firstDay = week.find(Boolean);
            // The opening column is labelled too, unless the next month's label
            // follows close enough to collide with it.
            const monthStart = weekIndex === 0 && firstDay && dateOf(firstDay) <= 21
              ? firstDay
              : week.find((day) => day && dateOf(day) === 1);
            return (
              <div key={weekIndex} className="spend-calendar-week flex flex-col gap-[3px] w-3">
                <div className="h-3 leading-3 whitespace-nowrap">
                  {monthStart && new Date(monthStart.startMs + HALF_DAY_MS).toLocaleDateString(undefined, { month: 'short' })}
                </div>
                {week.map((day, dayIndex) => {
                  if (!day) return <div key={dayIndex} className="h-3" />;
                  const intensity = max > 0 ? valueOf(day) / max : 0;
                  const label = `${new Date(day.startMs + HALF_DAY_MS).toLocaleDateString(undefined, {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })} · ${formatUSD(day.costUSD)} · ${formatCompactNumber(day.totalTokens)} tokens`;
                  return (
                    <div
                      key={dayIndex}
                      className="spend-calendar-day h-3 rounded-sm border border-nim"
                      // A 15% floor so a cheap day still reads apart from no usage.
                      style={{
                        backgroundColor:
                          intensity > 0
                            ? `color-mix(in srgb, var(--nim-primary) ${Math.round(15 + intensity * 65)}%, transparent)`
                            : undefined,
                      }}
                      title={label}
                      aria-label={label}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
        <div className="spend-calendar-legend flex items-center gap-1.5 justify-end">
          <span>Less</span>
          <div
            className="w-[100px] h-2 rounded-sm"
            style={{
              background:
                'linear-gradient(to right, transparent, color-mix(in srgb, var(--nim-primary) 80%, transparent))',
            }}
          />
          <span>More</span>
        </div>
      </div>
    </div>
  );
};

export const UsageOverview: React.FC<{ workspaceId?: string; sinceMs?: number }> = ({ workspaceId, sinceMs }) => {
  const [data, setData] = useState<UsageOverviewData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const result = await window.electronAPI.invoke(
          'usage-analytics:get-overview',
          workspaceId,
          sinceMs,
          new Date().getTimezoneOffset(),
        );
        if (!cancelled) setData(result);
      } catch (error) {
        console.error('[UsageOverview] Failed to load usage overview:', error);
        if (!cancelled) setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, sinceMs]);

  if (loading) {
    return <div className="usage-overview-loading flex items-center justify-center min-h-[300px] text-nim-muted text-base">Loading...</div>;
  }

  if (!data || data.totals.sessionCount === 0) {
    return (
      <div className="usage-overview-empty flex items-center justify-center min-h-[300px] text-nim-muted text-base">
        No AI activity in this range
      </div>
    );
  }

  const { totals } = data;
  const measure: Measure = totals.costUSD > 0 ? 'cost' : 'tokens';
  const measureTotal = measure === 'cost' ? totals.costUSD : totals.totalTokens;
  const unit = data.granularity === 'week' ? 'week' : 'day';

  const sliceValue = (slice: UsageSlice) => (measure === 'cost' ? slice.costUSD : slice.totalTokens);
  const sliceLabel = (slice: UsageSlice) =>
    measure === 'cost'
      ? `${slice.costEstimated ? '~' : ''}${formatUSD(slice.costUSD)}`
      : `${formatCompactNumber(slice.totalTokens)} tokens`;

  const spendDetail = [
    totals.costEstimated ? 'partly estimated from list prices' : undefined,
    totals.unpricedSessionCount > 0 ? `${plural(totals.unpricedSessionCount, 'session')} not priced` : undefined,
  ].filter(Boolean).join(' · ') || 'as reported by the providers';

  const chartData = data.trend.map((bucket) => ({
    label: new Date(bucket.startMs).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    fullLabel: data.granularity === 'week'
      ? `Week of ${new Date(bucket.startMs).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
      : new Date(bucket.startMs).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }),
    value: measure === 'cost' ? bucket.costUSD : bucket.totalTokens,
    costUSD: bucket.costUSD,
    totalTokens: bucket.totalTokens,
  }));

  return (
    <div className="usage-overview flex flex-col gap-4">
      <StatGrid>
        <StatCard
          label="Spend"
          value={measure === 'cost' ? `${totals.costEstimated ? '~' : ''}${formatUSD(totals.costUSD)}` : '--'}
          detail={measure === 'cost' ? spendDetail : 'No usage in this range could be priced'}
        />
        <StatCard
          label="Per active day"
          value={measure === 'cost'
            ? formatUSD(totals.costUSD / Math.max(totals.activeDays, 1))
            : formatCompactNumber(totals.totalTokens / Math.max(totals.activeDays, 1))}
          detail={plural(totals.activeDays, 'active day')}
        />
        <StatCard
          label="Tokens"
          value={formatCompactNumber(totals.totalTokens)}
          title={`${Math.round(totals.totalTokens).toLocaleString()} tokens`}
          detail={`${formatCompactNumber(totals.cacheReadTokens)} cached · ${formatCompactNumber(totals.inputTokens + totals.cacheWriteTokens)} new input · ${formatCompactNumber(totals.outputTokens)} output`}
        />
        <StatCard
          label="Sessions"
          value={totals.sessionCount.toLocaleString()}
          detail={`across ${plural(totals.projectCount, 'project')}`}
        />
      </StatGrid>

      <ReportSection
        className="usage-trend"
        title={`${measure === 'cost' ? 'Spend' : 'Tokens'} per ${unit}`}
        description={`Counted on the ${unit} each prompt was sent, not the day its session started.`}
      >
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--nim-border)" vertical={false} />
            <XAxis dataKey="label" stroke="var(--nim-text-muted)" tick={{ fontSize: 11 }} minTickGap={16} />
            <YAxis
              stroke="var(--nim-text-muted)"
              width={56}
              tick={{ fontSize: 11 }}
              tickFormatter={measure === 'cost' ? formatCompactUSD : formatCompactNumber}
            />
            <Tooltip
              cursor={{ fill: 'var(--nim-bg-tertiary)' }}
              labelFormatter={(_label, payload) =>
                (payload?.[0]?.payload as { fullLabel?: string } | undefined)?.fullLabel ?? String(_label)
              }
              formatter={(_value, _name, item) => {
                const point = item.payload as { costUSD: number; totalTokens: number };
                return [
                  `${formatUSD(point.costUSD)} · ${formatCompactNumber(point.totalTokens)} tokens`,
                  measure === 'cost' ? 'Spend' : 'Usage',
                ];
              }}
              contentStyle={CHART_TOOLTIP_STYLE}
            />
            <Bar dataKey="value" fill="var(--nim-primary)" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ReportSection>

      <ReportSection
        className="usage-calendar"
        title={`${measure === 'cost' ? 'Spend' : 'Tokens'} by day`}
        description="Each square is one day, up to the last 12 months. Hover a day for its spend."
      >
        <SpendCalendar daily={data.daily ?? []} sinceMs={sinceMs} measure={measure} />
      </ReportSection>

      <div className="usage-breakdowns grid grid-cols-[repeat(auto-fit,minmax(360px,1fr))] gap-4">
        <ReportSection className="usage-by-model" title="By model">
          <RankedBars
            total={measureTotal}
            rows={data.byModel.map((slice) => ({
              key: slice.model,
              label: slice.model,
              value: sliceValue(slice),
              valueLabel: sliceLabel(slice),
              detail: plural(slice.sessionCount, 'session'),
            }))}
          />
        </ReportSection>
        <ReportSection className="usage-by-project" title="By project">
          <RankedBars
            total={measureTotal}
            rows={data.byProject.map((slice) => ({
              key: slice.workspaceId,
              label: slice.workspaceId.split('/').pop() || slice.workspaceId || 'No project',
              title: slice.workspaceId,
              value: sliceValue(slice),
              valueLabel: sliceLabel(slice),
              detail: plural(slice.sessionCount, 'session'),
            }))}
          />
        </ReportSection>
      </div>
    </div>
  );
};
