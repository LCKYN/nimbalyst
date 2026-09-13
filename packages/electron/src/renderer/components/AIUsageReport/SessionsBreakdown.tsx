import React, { useEffect, useMemo, useState } from 'react';

interface SessionsBreakdownProps {
  workspaceId?: string;
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

export const SessionsBreakdown: React.FC<SessionsBreakdownProps> = ({ workspaceId }) => {
  const [rows, setRows] = useState<SessionUsageBreakdownRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [groupBy, setGroupBy] = useState<GroupBy>('none');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadData = async () => {
      setLoading(true);
      try {
        const result = await window.electronAPI.invoke('usage-analytics:get-session-breakdown', workspaceId);
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
  }, [workspaceId]);

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
        rows: groupRows,
        totalTokens: groupRows.reduce((sum, r) => sum + r.totalTokens, 0),
        costUSD: groupRows.reduce((sum, r) => sum + r.costUSD, 0),
        costEstimated: groupRows.some((r) => r.costEstimated),
      }))
      .sort((a, b) => b.costUSD - a.costUSD);
  }, [rows, groupBy]);

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
      <div className="sessions-breakdown-header flex items-center justify-between">
        <h3 className="m-0 text-sm font-semibold text-[var(--nim-text)]">Sessions</h3>
        <div className="sessions-breakdown-group-control flex items-center gap-2 text-xs">
          <span className="text-[var(--nim-text-muted)]">Group by</span>
          {(Object.keys(GROUP_BY_LABELS) as GroupBy[]).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setGroupBy(option)}
              className={`sessions-breakdown-group-option px-2 py-1 rounded-sm border border-nim ${
                groupBy === option
                  ? 'bg-[var(--nim-primary)] text-white'
                  : 'text-[var(--nim-text-muted)] hover:text-[var(--nim-text)]'
              }`}
            >
              {GROUP_BY_LABELS[option]}
            </button>
          ))}
        </div>
      </div>

      {groups.map((group) => (
        <div key={group.key} className="sessions-breakdown-group flex flex-col gap-2">
          {groupBy !== 'none' && (
            <div className="sessions-breakdown-group-subtotal flex items-center justify-between text-xs font-semibold text-[var(--nim-text-muted)] pt-2 border-t border-nim">
              <span>{group.key}</span>
              <span>
                {formatTokens(group.totalTokens)} tokens ·{' '}
                <CostCell costUSD={group.costUSD} costEstimated={group.costEstimated} />
              </span>
            </div>
          )}

          <table className="sessions-breakdown-table w-full text-xs border-collapse">
            <thead>
              <tr className="text-left text-[var(--nim-text-muted)]">
                <th className="py-1 pr-2 font-medium">Session</th>
                <th className="py-1 pr-2 font-medium">Model</th>
                <th className="py-1 pr-2 font-medium text-right">Tokens</th>
                <th className="py-1 pr-2 font-medium text-right">Cost</th>
                <th className="py-1 pr-2 font-medium text-right">Cache read/write</th>
                <th className="py-1 pr-2 font-medium text-right">Main/subagent</th>
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
                        {row.title}
                      </td>
                      <td className="py-1.5 pr-2 text-[var(--nim-text-muted)]">
                        {row.provider}
                        {row.model ? ` / ${row.model}` : ''}
                      </td>
                      <td className="py-1.5 pr-2 text-right text-[var(--nim-text)]">{formatTokens(row.totalTokens)}</td>
                      <td className="py-1.5 pr-2 text-right text-[var(--nim-text)]">
                        <CostCell costUSD={row.costUSD} costEstimated={row.costEstimated} />
                      </td>
                      <td className="py-1.5 pr-2 text-right text-[var(--nim-text-muted)]">
                        {formatTokens(row.cacheReadInputTokens)} / {formatTokens(row.cacheCreationInputTokens)}
                      </td>
                      <td className="py-1.5 pr-2 text-right text-[var(--nim-text-muted)]">
                        {row.mainUsage || row.subagentUsage
                          ? `${formatTokens(mainTokens)} / ${formatTokens(subagentTokens)}`
                          : '—'}
                      </td>
                    </tr>
                    {isExpanded && hasByModel && (
                      <tr className="sessions-breakdown-model-detail bg-[var(--nim-bg-tertiary)]">
                        <td colSpan={6} className="py-2 px-2">
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
          </table>
        </div>
      ))}
    </div>
  );
};
