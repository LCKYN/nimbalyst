import React, { useEffect, useMemo, useState } from 'react';
import { SectionHeading, SegmentedControl } from './ReportControls';

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

interface SessionUsageBreakdownRow {
  id: string;
  title: string;
  provider: string;
  model: string | null;
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

type GroupBy = 'none' | 'phase' | 'tags';

const GROUP_BY_LABELS: Record<GroupBy, string> = {
  none: 'None',
  phase: 'Phase',
  tags: 'Tags',
};

/** Columns the table can be ordered by. `title` and `model` sort as text; the rest numerically. */
type SortKey = 'title' | 'model' | 'inputTokens' | 'outputTokens' | 'totalTokens' | 'costUSD' | 'createdAt';

interface SortState {
  key: SortKey;
  direction: 'asc' | 'desc';
}

export function compareRows(
  a: SessionUsageBreakdownRow,
  b: SessionUsageBreakdownRow,
  sort: SortState,
): number {
  const factor = sort.direction === 'asc' ? 1 : -1;
  if (sort.key === 'title') return factor * a.title.localeCompare(b.title);
  if (sort.key === 'model') {
    const modelOf = (row: SessionUsageBreakdownRow) => `${row.provider}${row.model ? ` / ${row.model}` : ''}`;
    return factor * modelOf(a).localeCompare(modelOf(b));
  }
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

const ESTIMATED_COST_TOOLTIP = "Estimated from published pricing — this provider doesn't report exact cost";

function formatTokens(n: number): string {
  return n.toLocaleString();
}

/** `groupBy: 'tags'` buckets a multi-tag session under its FIRST tag only, so a session appears once, not once per tag. */
function groupKeyFor(row: SessionUsageBreakdownRow, groupBy: GroupBy): string {
  if (groupBy === 'phase') return row.phase || 'No phase';
  if (groupBy === 'tags') return row.tags && row.tags.length > 0 ? row.tags[0] : 'Untagged';
  return 'All sessions';
}

const SortableHeader: React.FC<{
  sortKey: SortKey;
  sort: SortState;
  onSort: (key: SortKey) => void;
  align?: 'left' | 'right';
  children: React.ReactNode;
}> = ({ sortKey, sort, onSort, align = 'left', children }) => {
  const active = sort.key === sortKey;
  return (
    <th
      className={`sessions-breakdown-header py-1 pr-2 font-medium cursor-pointer select-none hover:text-[var(--nim-text)] ${
        align === 'right' ? 'text-right' : ''
      } ${active ? 'text-[var(--nim-text)]' : ''}`}
      onClick={() => onSort(sortKey)}
      aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      {children}
      {active ? (sort.direction === 'asc' ? ' ▲' : ' ▼') : ''}
    </th>
  );
};

const CostCell: React.FC<{ costUSD: number; costEstimated: boolean; className?: string }> = ({
  costUSD,
  costEstimated,
  className,
}) => (
  <span className={className} title={costEstimated ? ESTIMATED_COST_TOOLTIP : undefined}>
    ${costUSD.toFixed(costUSD < 1 && costUSD > 0 ? 4 : 2)}
    {costEstimated ? '*' : ''}
  </span>
);

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
    const byKey = new Map<string, SessionUsageBreakdownRow[]>();
    for (const row of rows) {
      const key = groupKeyFor(row, groupBy);
      const existing = byKey.get(key);
      if (existing) existing.push(row);
      else byKey.set(key, [row]);
    }
    return Array.from(byKey.entries())
      .map(([key, groupRows]) => ({
        key,
        rows: [...groupRows].sort((a, b) => compareRows(a, b, sort)),
        totals: totalsFor(groupRows),
      }))
      .sort((a, b) => b.totals.costUSD - a.totals.costUSD);
  }, [rows, groupBy, sort]);

  const grandTotals = useMemo(() => totalsFor(rows), [rows]);

  // main/subagent and cache figures only exist for turns streamed after #1496.
  // On an older history every one of those cells reads "—" or "0 / 0", so the
  // columns are hidden rather than shown empty.
  const showCacheColumns = useMemo(
    () => rows.some((r) => r.cacheReadInputTokens > 0 || r.cacheCreationInputTokens > 0),
    [rows],
  );
  const showOriginColumns = useMemo(() => rows.some((r) => r.mainUsage || r.subagentUsage), [rows]);
  const columnCount = 6 + (showCacheColumns ? 1 : 0) + (showOriginColumns ? 1 : 0);

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
        No session usage data yet. Run an AI session to see it here.
      </div>
    );
  }

  return (
    <div className="sessions-breakdown flex flex-col gap-4">
      <div className="sessions-breakdown-header flex items-center justify-between gap-4">
        <SectionHeading>Sessions</SectionHeading>
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

      {groups.map((group) => (
        <div key={group.key} className="sessions-breakdown-group flex flex-col gap-2">
          {groupBy !== 'none' && (
            <div className="sessions-breakdown-group-subtotal flex items-center justify-between text-xs font-semibold text-[var(--nim-text-muted)] pt-2 border-t border-nim">
              <span>{group.key}</span>
              <span>
                {formatTokens(group.totals.totalTokens)} tokens ·{' '}
                <CostCell costUSD={group.totals.costUSD} costEstimated={group.totals.costEstimated} />
              </span>
            </div>
          )}

          <table className="sessions-breakdown-table w-full text-xs border-collapse">
            <thead>
              <tr className="text-left text-[var(--nim-text-muted)]">
                <SortableHeader sortKey="title" sort={sort} onSort={toggleSort}>Session</SortableHeader>
                <SortableHeader sortKey="model" sort={sort} onSort={toggleSort}>Model</SortableHeader>
                <SortableHeader sortKey="inputTokens" sort={sort} onSort={toggleSort} align="right">Input</SortableHeader>
                <SortableHeader sortKey="outputTokens" sort={sort} onSort={toggleSort} align="right">Output</SortableHeader>
                <SortableHeader sortKey="totalTokens" sort={sort} onSort={toggleSort} align="right">Tokens</SortableHeader>
                <SortableHeader sortKey="costUSD" sort={sort} onSort={toggleSort} align="right">Cost</SortableHeader>
                {showCacheColumns && <th className="py-1 pr-2 font-medium text-right">Cache read/write</th>}
                {showOriginColumns && <th className="py-1 pr-2 font-medium text-right">Main/subagent</th>}
              </tr>
            </thead>
            <tbody>
              {group.rows.map((row) => {
                const hasByModel = !!row.byModel && Object.keys(row.byModel).length > 0;
                const isExpanded = expandedId === row.id;
                const mainTokens = (row.mainUsage?.inputTokens ?? 0) + (row.mainUsage?.outputTokens ?? 0);
                const subagentTokens = (row.subagentUsage?.inputTokens ?? 0) + (row.subagentUsage?.outputTokens ?? 0);
                return (
                  <React.Fragment key={row.id}>
                    <tr
                      className={`sessions-breakdown-row border-t border-nim ${hasByModel ? 'cursor-pointer' : ''}`}
                      onClick={() => hasByModel && setExpandedId(isExpanded ? null : row.id)}
                    >
                      <td className="py-1.5 pr-2 text-[var(--nim-text)] truncate max-w-[220px]" title={row.title}>
                        {hasByModel ? (isExpanded ? '▾ ' : '▸ ') : ''}
                        {row.workspaceId ? (
                          <button
                            type="button"
                            className="sessions-breakdown-open text-nim-link hover:underline"
                            // The row itself toggles the per-model detail, so the
                            // click must not reach it or opening a session would
                            // also expand the row behind the newly focused window.
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
                      <td className="py-1.5 pr-2 text-[var(--nim-text-muted)]">
                        {row.provider}
                        {row.model ? ` / ${row.model}` : ''}
                      </td>
                      <td className="py-1.5 pr-2 text-right text-[var(--nim-text-muted)]">{formatTokens(row.inputTokens)}</td>
                      <td className="py-1.5 pr-2 text-right text-[var(--nim-text-muted)]">{formatTokens(row.outputTokens)}</td>
                      <td className="py-1.5 pr-2 text-right text-[var(--nim-text)]">{formatTokens(row.totalTokens)}</td>
                      <td className="py-1.5 pr-2 text-right text-[var(--nim-text)]">
                        <CostCell costUSD={row.costUSD} costEstimated={row.costEstimated} />
                      </td>
                      {showCacheColumns && (
                        <td className="py-1.5 pr-2 text-right text-[var(--nim-text-muted)]">
                          {formatTokens(row.cacheReadInputTokens)} / {formatTokens(row.cacheCreationInputTokens)}
                        </td>
                      )}
                      {showOriginColumns && (
                        <td className="py-1.5 pr-2 text-right text-[var(--nim-text-muted)]">
                          {row.mainUsage || row.subagentUsage
                            ? `${formatTokens(mainTokens)} / ${formatTokens(subagentTokens)}`
                            : '—'}
                        </td>
                      )}
                    </tr>
                    {isExpanded && hasByModel && (
                      <tr className="sessions-breakdown-model-detail bg-[var(--nim-bg-tertiary)]">
                        <td colSpan={columnCount} className="py-2 px-2">
                          <table className="w-full text-[11px]">
                            <thead>
                              <tr className="text-left text-[var(--nim-text-muted)]">
                                <th className="py-0.5 pr-2 font-medium">Model</th>
                                <th className="py-0.5 pr-2 font-medium text-right">Input</th>
                                <th className="py-0.5 pr-2 font-medium text-right">Output</th>
                                <th className="py-0.5 pr-2 font-medium text-right">Cache read/write</th>
                                <th className="py-0.5 pr-2 font-medium text-right">Cost</th>
                              </tr>
                            </thead>
                            <tbody>
                              {Object.entries(row.byModel!).map(([modelName, bucket]) => (
                                <tr key={modelName}>
                                  <td className="py-0.5 pr-2 text-[var(--nim-text)]">{modelName}</td>
                                  <td className="py-0.5 pr-2 text-right">{formatTokens(bucket.inputTokens)}</td>
                                  <td className="py-0.5 pr-2 text-right">{formatTokens(bucket.outputTokens)}</td>
                                  <td className="py-0.5 pr-2 text-right">
                                    {formatTokens(bucket.cacheReadInputTokens ?? 0)} / {formatTokens(bucket.cacheCreationInputTokens ?? 0)}
                                  </td>
                                  <td className="py-0.5 pr-2 text-right">
                                    {bucket.costUSD !== undefined ? (
                                      <CostCell costUSD={bucket.costUSD} costEstimated={row.costEstimated} />
                                    ) : (
                                      '—'
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <TotalsRow label={groupBy === 'none' ? 'Total' : `${group.key} total`} totals={group.totals} />
            </tfoot>
          </table>
        </div>
      ))}

      {/* With grouping on, each table foots its own group -- this is the only
          place the filtered set is totalled as a whole. */}
      {groupBy !== 'none' && groups.length > 1 && (
        <table className="sessions-breakdown-grand-total w-full text-xs border-collapse">
          <tfoot>
            <TotalsRow label="All groups" totals={grandTotals} />
          </tfoot>
        </table>
      )}
    </div>
  );
};

const TotalsRow: React.FC<{ label: string; totals: ColumnTotals }> = ({ label, totals }) => (
  <tr className="sessions-breakdown-totals border-t-2 border-nim font-semibold text-[var(--nim-text)]">
    <td className="py-1.5 pr-2">{label}</td>
    <td className="py-1.5 pr-2" />
    <td className="py-1.5 pr-2 text-right">{formatTokens(totals.inputTokens)}</td>
    <td className="py-1.5 pr-2 text-right">{formatTokens(totals.outputTokens)}</td>
    <td className="py-1.5 pr-2 text-right">{formatTokens(totals.totalTokens)}</td>
    <td className="py-1.5 pr-2 text-right">
      <CostCell costUSD={totals.costUSD} costEstimated={totals.costEstimated} />
    </td>
    <td className="py-1.5 pr-2 text-right">
      {formatTokens(totals.cacheReadInputTokens)} / {formatTokens(totals.cacheCreationInputTokens)}
    </td>
    <td className="py-1.5 pr-2 text-right" />
  </tr>
);
