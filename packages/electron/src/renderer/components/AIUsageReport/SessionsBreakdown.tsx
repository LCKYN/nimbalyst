import React, { useEffect, useMemo, useState } from 'react';
import { SectionHeading, SegmentedControl, SortableHeader, type SortState as BaseSortState } from './ReportControls';
import { formatCompactNumber, formatUSD } from './usageFormat';

interface SessionsBreakdownProps {
  workspaceId?: string;
  sinceMs?: number;
}

interface TokenUsageBucketRow {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  costUSD?: number;
}

/** Mirrors `SessionUsageBreakdownRow` in main/services/UsageAnalyticsService.ts. */
interface SessionUsageBreakdownRow {
  id: string;
  title: string;
  provider: string;
  model: string | null;
  modelLabel: string;
  workstreamTitle: string;
  rangeShare: number;
  lastActiveAt: number;
  phase?: string;
  tags?: string[];
  parentSessionId: string | null;
  createdBySessionId: string | null;
  workstreamRootId: string;
  workspaceId: string | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUSD: number;
  costEstimated: boolean;
  mainUsage?: TokenUsageBucketRow;
  subagentUsage?: TokenUsageBucketRow;
  byModel?: Record<string, TokenUsageBucketRow>;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  createdAt: number;
  updatedAt: number;
}

type GroupBy = 'none' | 'workstream' | 'phase' | 'tags';

const GROUP_BY_LABELS: Record<GroupBy, string> = {
  none: 'None',
  workstream: 'Workstream',
  phase: 'Phase',
  tags: 'Tags',
};

/** Columns the table can be ordered by. `title` and `model` sort as text; the rest numerically. */
type SortKey = 'title' | 'model' | 'costUSD' | 'totalTokens' | 'lastActiveAt';

type SortState = BaseSortState<SortKey>;

/** How many of the costliest sessions the summary line measures concentration over. */
const TOP_N = 10;

export function compareRows(
  a: SessionUsageBreakdownRow,
  b: SessionUsageBreakdownRow,
  sort: SortState,
): number {
  const factor = sort.direction === 'asc' ? 1 : -1;
  if (sort.key === 'title') return factor * a.title.localeCompare(b.title);
  if (sort.key === 'model') return factor * a.modelLabel.localeCompare(b.modelLabel);
  return factor * (a[sort.key] - b[sort.key]);
}

export interface ColumnTotals {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUSD: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  costEstimated: boolean;
}

export function totalsFor(rows: SessionUsageBreakdownRow[]): ColumnTotals {
  return rows.reduce<ColumnTotals>(
    (sum, row) => ({
      inputTokens: sum.inputTokens + row.inputTokens,
      outputTokens: sum.outputTokens + row.outputTokens,
      totalTokens: sum.totalTokens + row.totalTokens,
      costUSD: sum.costUSD + row.costUSD,
      cacheReadInputTokens: sum.cacheReadInputTokens + row.cacheReadInputTokens,
      cacheCreationInputTokens: sum.cacheCreationInputTokens + row.cacheCreationInputTokens,
      // One estimated row makes the whole column an estimate; saying otherwise
      // would present a total as exact when part of it is not.
      costEstimated: sum.costEstimated || row.costEstimated,
    }),
    {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUSD: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      costEstimated: false,
    },
  );
}

/**
 * Share of spend held by the `n` costliest sessions -- the one number that says
 * whether cost is spread evenly or dominated by a few runaway sessions.
 */
export function topShare(rows: SessionUsageBreakdownRow[], n: number): number {
  const total = rows.reduce((sum, row) => sum + row.costUSD, 0);
  if (total <= 0) return 0;
  const top = [...rows].sort((a, b) => b.costUSD - a.costUSD).slice(0, n);
  return top.reduce((sum, row) => sum + row.costUSD, 0) / total;
}

const ESTIMATED_COST_TOOLTIP = "Estimated from published pricing -- this provider doesn't report exact cost";

/** `groupBy: 'tags'` buckets a multi-tag session under its FIRST tag only, so a session appears once, not once per tag. */
function groupFor(row: SessionUsageBreakdownRow, groupBy: GroupBy): { key: string; label: string } {
  if (groupBy === 'workstream') return { key: row.workstreamRootId, label: row.workstreamTitle };
  if (groupBy === 'phase') return { key: row.phase || 'No phase', label: row.phase || 'No phase' };
  if (groupBy === 'tags') {
    const tag = row.tags && row.tags.length > 0 ? row.tags[0] : 'Untagged';
    return { key: tag, label: tag };
  }
  return { key: 'all', label: 'All sessions' };
}

function plural(n: number, word: string): string {
  return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
}

const Cost: React.FC<{ costUSD: number; costEstimated: boolean }> = ({ costUSD, costEstimated }) => (
  <span title={costEstimated ? ESTIMATED_COST_TOOLTIP : undefined}>
    {costEstimated ? '~' : ''}
    {formatUSD(costUSD)}
  </span>
);

const Tokens: React.FC<{ value: number }> = ({ value }) => (
  <span title={`${Math.round(value).toLocaleString()} tokens`}>{formatCompactNumber(value)}</span>
);

/** One labelled figure inside an expanded row. */
const DetailFigure: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="sessions-detail-figure flex justify-between gap-4">
    <span className="text-nim-muted">{label}</span>
    <span className="text-nim">{children}</span>
  </div>
);

const SessionDetail: React.FC<{ row: SessionUsageBreakdownRow }> = ({ row }) => {
  const byModel = row.byModel ? Object.entries(row.byModel).sort((a, b) => (b[1].costUSD ?? 0) - (a[1].costUSD ?? 0)) : [];
  const bucketTokens = (b: TokenUsageBucketRow) =>
    b.inputTokens + b.outputTokens + (b.cacheReadInputTokens ?? 0) + (b.cacheCreationInputTokens ?? 0);

  return (
    <div className="sessions-detail flex flex-col gap-3 py-3 px-3 text-[11px]">
      {row.rangeShare < 1 && (
        <div className="sessions-detail-range text-nim-muted">
          {Math.round(row.rangeShare * 100)}% of this session&apos;s prompts fall in this range; the figures are that share.
        </div>
      )}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-6">
        <div className="sessions-detail-tokens flex flex-col gap-1">
          <div className="font-semibold text-nim mb-0.5">Tokens</div>
          <DetailFigure label="New input"><Tokens value={row.inputTokens} /></DetailFigure>
          <DetailFigure label="Cache reads"><Tokens value={row.cacheReadInputTokens} /></DetailFigure>
          <DetailFigure label="Cache writes"><Tokens value={row.cacheCreationInputTokens} /></DetailFigure>
          <DetailFigure label="Output"><Tokens value={row.outputTokens} /></DetailFigure>
        </div>

        {(row.mainUsage || row.subagentUsage) && (
          <div className="sessions-detail-origin flex flex-col gap-1">
            <div className="font-semibold text-nim mb-0.5">Who did the work</div>
            {row.mainUsage && (
              <DetailFigure label="Main agent">
                <Cost costUSD={row.mainUsage.costUSD ?? 0} costEstimated={row.costEstimated} /> · <Tokens value={bucketTokens(row.mainUsage)} />
              </DetailFigure>
            )}
            {row.subagentUsage && (
              <DetailFigure label="Sub-agents">
                <Cost costUSD={row.subagentUsage.costUSD ?? 0} costEstimated={row.costEstimated} /> · <Tokens value={bucketTokens(row.subagentUsage)} />
              </DetailFigure>
            )}
          </div>
        )}

        {byModel.length > 0 && (
          <div className="sessions-detail-models flex flex-col gap-1">
            <div className="font-semibold text-nim mb-0.5">By model</div>
            {byModel.map(([model, bucket]) => (
              <DetailFigure key={model} label={model}>
                <Cost costUSD={bucket.costUSD ?? 0} costEstimated={row.costEstimated} /> · <Tokens value={bucketTokens(bucket)} />
              </DetailFigure>
            ))}
          </div>
        )}
      </div>
      {!row.mainUsage && !row.subagentUsage && byModel.length === 0 && (
        <div className="text-nim-muted">
          Per-model and sub-agent figures are only recorded for turns run since they were added.
        </div>
      )}
    </div>
  );
};

export const SessionsBreakdown: React.FC<SessionsBreakdownProps> = ({ workspaceId, sinceMs }) => {
  const [rows, setRows] = useState<SessionUsageBreakdownRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [groupBy, setGroupBy] = useState<GroupBy>('none');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState>({ key: 'costUSD', direction: 'desc' });

  // Clicking the active column flips direction; a new column starts descending,
  // which is what you want for every numeric column here.
  const toggleSort = (key: SortKey) =>
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === 'desc' ? 'asc' : 'desc' }
        : { key, direction: key === 'title' || key === 'model' ? 'asc' : 'desc' },
    );

  useEffect(() => {
    let cancelled = false;
    const loadData = async () => {
      setLoading(true);
      try {
        const result = await window.electronAPI.invoke('usage-analytics:get-session-breakdown', workspaceId, sinceMs);
        if (!cancelled) setRows(Array.isArray(result) ? result : []);
      } catch (error) {
        console.error('[SessionsBreakdown] Failed to load session usage breakdown:', error);
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void loadData();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, sinceMs]);

  const groups = useMemo(() => {
    const byKey = new Map<string, { label: string; rows: SessionUsageBreakdownRow[] }>();
    for (const row of rows) {
      const { key, label } = groupFor(row, groupBy);
      const existing = byKey.get(key);
      if (existing) existing.rows.push(row);
      else byKey.set(key, { label, rows: [row] });
    }
    return Array.from(byKey.entries())
      .map(([key, group]) => ({
        key,
        label: group.label,
        rows: [...group.rows].sort((a, b) => compareRows(a, b, sort)),
        totals: totalsFor(group.rows),
      }))
      .sort((a, b) => b.totals.costUSD - a.totals.costUSD || b.totals.totalTokens - a.totals.totalTokens);
  }, [rows, groupBy, sort]);

  const grandTotals = useMemo(() => totalsFor(rows), [rows]);
  // The share bar follows the same measure as the Overview: spend, unless
  // nothing in range could be priced.
  const byCost = grandTotals.costUSD > 0;
  const shareOf = (totals: { costUSD: number; totalTokens: number }) => {
    const whole = byCost ? grandTotals.costUSD : grandTotals.totalTokens;
    return whole > 0 ? ((byCost ? totals.costUSD : totals.totalTokens) / whole) * 100 : 0;
  };

  const openSession = (row: SessionUsageBreakdownRow) => {
    if (!row.workspaceId) return;
    void window.electronAPI
      .invoke('usage-report:open-session', row.id, row.workspaceId)
      .catch((error: unknown) =>
        console.error('[SessionsBreakdown] Failed to open session:', error),
      );
  };

  if (loading) {
    return (
      <div className="sessions-breakdown-loading flex items-center justify-center min-h-[200px] text-sm text-nim-muted">
        Loading...
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="sessions-breakdown-empty flex items-center justify-center min-h-[200px] text-sm text-nim-muted">
        No AI sessions were active in this range.
      </div>
    );
  }

  const summary = [
    plural(rows.length, 'session'),
    byCost ? `${grandTotals.costEstimated ? '~' : ''}${formatUSD(grandTotals.costUSD)}` : `${formatCompactNumber(grandTotals.totalTokens)} tokens`,
    byCost && rows.length > TOP_N ? `top ${TOP_N} are ${Math.round(topShare(rows, TOP_N) * 100)}% of spend` : undefined,
  ].filter(Boolean).join(' · ');

  return (
    <div className="sessions-breakdown flex flex-col gap-4">
      <div className="sessions-breakdown-header flex items-start justify-between gap-4">
        <SectionHeading description="Sessions active in this range, costliest first. A session that ran partly outside the range counts only the part inside it.">
          Sessions
        </SectionHeading>
        <SegmentedControl
          label="Group by"
          options={(Object.keys(GROUP_BY_LABELS) as GroupBy[]).map((value) => ({
            value,
            label: GROUP_BY_LABELS[value],
          }))}
          value={groupBy}
          onChange={setGroupBy}
        />
      </div>

      <div className="sessions-breakdown-summary text-sm text-nim select-text">{summary}</div>

      <table className="sessions-breakdown-table w-full text-xs border-collapse table-fixed">
        <colgroup>
          <col />
          <col className="w-[140px]" />
          <col className="w-[180px]" />
          <col className="w-[90px]" />
          <col className="w-[100px]" />
        </colgroup>
        <thead>
          <tr className="text-left text-nim-muted">
            <SortableHeader sortKey="title" sort={sort} onSort={toggleSort}>Session</SortableHeader>
            <SortableHeader sortKey="model" sort={sort} onSort={toggleSort}>Model</SortableHeader>
            <SortableHeader sortKey="costUSD" sort={sort} onSort={toggleSort}>{byCost ? 'Cost' : 'Share'}</SortableHeader>
            <SortableHeader sortKey="totalTokens" sort={sort} onSort={toggleSort} align="right">Tokens</SortableHeader>
            <SortableHeader sortKey="lastActiveAt" sort={sort} onSort={toggleSort} align="right">Last active</SortableHeader>
          </tr>
        </thead>
        {groups.map((group) => (
          <tbody key={group.key} className="sessions-breakdown-group">
            {groupBy !== 'none' && (
              <tr className="sessions-breakdown-group-header border-t-2 border-nim">
                <td className="pt-3 pb-1 pr-3 font-semibold text-nim truncate" title={group.label}>
                  {group.label}
                  <span className="font-normal text-nim-muted"> · {plural(group.rows.length, 'session')}</span>
                </td>
                <td />
                <td className="pt-3 pb-1 pr-3 font-semibold text-nim">
                  <Cost costUSD={group.totals.costUSD} costEstimated={group.totals.costEstimated} />
                  <span className="font-normal text-nim-muted"> · {Math.round(shareOf(group.totals))}%</span>
                </td>
                <td className="pt-3 pb-1 pr-3 text-right font-semibold text-nim"><Tokens value={group.totals.totalTokens} /></td>
                <td />
              </tr>
            )}
            {group.rows.map((row) => {
              const isExpanded = expandedId === row.id;
              const share = shareOf(row);
              return (
                <React.Fragment key={row.id}>
                  <tr
                    className={`sessions-breakdown-row border-t border-nim cursor-pointer hover:bg-[var(--nim-bg-hover)] ${
                      isExpanded ? 'bg-[var(--nim-bg-hover)]' : ''
                    }`}
                    onClick={() => setExpandedId(isExpanded ? null : row.id)}
                    aria-expanded={isExpanded}
                  >
                    <td className="py-2 pr-3 text-nim truncate" title={row.title}>
                      <span className="text-nim-muted mr-1">{isExpanded ? '▾' : '▸'}</span>
                      {row.workspaceId ? (
                        <button
                          type="button"
                          className="sessions-breakdown-open text-nim hover:text-nim-link hover:underline"
                          // The row itself toggles the detail, so the click must
                          // not reach it or opening a session would also expand
                          // the row behind the newly focused window.
                          onClick={(event) => {
                            event.stopPropagation();
                            openSession(row);
                          }}
                          title={`Open ${row.title}`}
                        >
                          {row.title}
                        </button>
                      ) : (
                        row.title
                      )}
                    </td>
                    <td className="py-2 pr-3 text-nim-muted truncate" title={row.model ?? row.provider}>
                      {row.modelLabel}
                    </td>
                    <td className="py-2 pr-3">
                      <div className="flex items-center gap-2">
                        <span className="w-[64px] shrink-0 text-nim">
                          {byCost ? <Cost costUSD={row.costUSD} costEstimated={row.costEstimated} /> : `${Math.round(share)}%`}
                        </span>
                        <div className="sessions-breakdown-share h-1.5 flex-1 bg-[var(--nim-bg-tertiary)] rounded-sm overflow-hidden">
                          <div className="h-full bg-[var(--nim-primary)] rounded-sm" style={{ width: `${share}%` }} />
                        </div>
                      </div>
                    </td>
                    <td className="py-2 pr-3 text-right text-nim-muted"><Tokens value={row.totalTokens} /></td>
                    <td className="py-2 pr-3 text-right text-nim-muted">
                      {new Date(row.lastActiveAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="sessions-breakdown-detail-row bg-[var(--nim-bg-tertiary)]">
                      <td colSpan={5}>
                        <SessionDetail row={row} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        ))}
        <tfoot>
          <tr className="sessions-breakdown-totals border-t-2 border-nim font-semibold text-nim">
            <td className="py-2 pr-3">Total</td>
            <td />
            <td className="py-2 pr-3">
              <Cost costUSD={grandTotals.costUSD} costEstimated={grandTotals.costEstimated} />
            </td>
            <td className="py-2 pr-3 text-right"><Tokens value={grandTotals.totalTokens} /></td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
};
