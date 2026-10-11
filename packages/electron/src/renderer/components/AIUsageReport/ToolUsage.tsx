import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import {
  CHART_TOOLTIP_STYLE,
  RankedBars,
  ReportSection,
  SortableHeader,
  StatCard,
  StatGrid,
  type SortState,
} from './ReportControls';
import { fillDailyCounts, formatCompactNumber } from './usageFormat';

interface ToolUsageProps {
  workspaceId?: string;
  sinceMs?: number;
}

export interface ToolUsageReportRow {
  toolName: string;
  mcpServer: string | null;
  count: number;
  errorCount: number;
  callTokens: number;
  resultTokens: number;
}

interface ToolUsageReport {
  topTools: ToolUsageReportRow[];
  heaviestTools: ToolUsageReportRow[];
  byKind: { builtin: number; mcp: number };
  errorCount: number;
  tokens: { call: number; result: number };
  sizeBackfillPending: boolean;
  byProvider: Array<{ provider: string; count: number }>;
  overTime: Array<{ day: string; count: number }>;
  byProject: Array<{ projectPath: string; count: number }>;
}

/** Rows in the tools table before "Show all". */
const TABLE_ROWS = 15;

/**
 * What makes a tool worth a look. Failures need a floor on the count so one
 * failure in two calls isn't flagged as "50% failing".
 */
const FAIL_RATE = 0.15;
const FAIL_MIN_ERRORS = 5;
const HEAVY_PER_CALL_TOKENS = 5_000;
const HEAVY_MIN_CALLS = 5;
const HEAVY_SHARE = 0.25;

const tokensOf = (tool: ToolUsageReportRow) => tool.callTokens + tool.resultTokens;
const failRateOf = (tool: ToolUsageReportRow) => (tool.count > 0 ? tool.errorCount / tool.count : 0);
const perCallOf = (tool: ToolUsageReportRow) => (tool.count > 0 ? tokensOf(tool) / tool.count : 0);
const isFailing = (tool: ToolUsageReportRow) => tool.errorCount >= FAIL_MIN_ERRORS && failRateOf(tool) >= FAIL_RATE;
const isHeavyPerCall = (tool: ToolUsageReportRow) =>
  tool.count >= HEAVY_MIN_CALLS && perCallOf(tool) >= HEAVY_PER_CALL_TOKENS;

export interface ToolConcern {
  tool: ToolUsageReportRow;
  reasons: Array<{ kind: 'failing' | 'heavy'; text: string }>;
  /** How far past its threshold the worst reason is; sorts the list. */
  severity: number;
}

/** Tools that fail often, cost a lot per call, or dominate tool tokens -- worst first. */
export function findToolConcerns(tools: ToolUsageReportRow[], totalToolTokens: number): ToolConcern[] {
  const concerns: ToolConcern[] = [];
  for (const tool of tools) {
    const reasons: ToolConcern['reasons'] = [];
    let severity = 0;
    const failRate = failRateOf(tool);
    if (isFailing(tool)) {
      reasons.push({
        kind: 'failing',
        text: `${percent(tool.errorCount, tool.count)} of calls failed or were declined (${tool.errorCount.toLocaleString()} of ${tool.count.toLocaleString()})`,
      });
      severity = Math.max(severity, failRate / FAIL_RATE);
    }
    const perCall = perCallOf(tool);
    if (isHeavyPerCall(tool)) {
      reasons.push({
        kind: 'heavy',
        text: `~${formatCompactNumber(perCall)} tokens per call, and each result is re-read on later turns`,
      });
      severity = Math.max(severity, perCall / HEAVY_PER_CALL_TOKENS);
    }
    const share = totalToolTokens > 0 ? tokensOf(tool) / totalToolTokens : 0;
    if (share >= HEAVY_SHARE) {
      reasons.push({
        kind: 'heavy',
        text: `${percent(tokensOf(tool), totalToolTokens)} of all tool tokens (~${formatCompactNumber(tokensOf(tool))})`,
      });
      severity = Math.max(severity, share / HEAVY_SHARE);
    }
    if (reasons.length > 0) concerns.push({ tool, reasons, severity });
  }
  return concerns.sort((a, b) => b.severity - a.severity);
}

/** `topTools` is the top 100 by calls and `heaviestTools` the top 100 by tokens; the table wants both. */
export function mergeToolRows(report: Pick<ToolUsageReport, 'topTools' | 'heaviestTools'>): ToolUsageReportRow[] {
  const byName = new Map<string, ToolUsageReportRow>();
  for (const tool of [...report.topTools, ...report.heaviestTools]) {
    if (!byName.has(tool.toolName)) byName.set(tool.toolName, tool);
  }
  return [...byName.values()];
}

type ToolSortKey = 'name' | 'count' | 'failRate' | 'tokens' | 'perCall';

const SORT_VALUE: Record<Exclude<ToolSortKey, 'name'>, (tool: ToolUsageReportRow) => number> = {
  count: (tool) => tool.count,
  failRate: failRateOf,
  tokens: tokensOf,
  perCall: perCallOf,
};

/** Trim `mcp__server__tool` down to the tool; the server goes in the detail line. */
function displayToolName(row: ToolUsageReportRow): string {
  return row.mcpServer ? row.toolName.replace(`mcp__${row.mcpServer}__`, '') : row.toolName;
}

function displayProjectName(projectPath: string): string {
  if (projectPath === '(none)') return 'No project';
  return projectPath.split(/[\\/]/).filter(Boolean).pop() || projectPath;
}

function percent(part: number, whole: number): string {
  if (whole <= 0) return '0%';
  const value = (part / whole) * 100;
  if (value > 0 && value < 1) return '<1%';
  return `${value < 10 ? value.toFixed(1).replace(/\.0$/, '') : Math.round(value)}%`;
}

const ToolName: React.FC<{ tool: ToolUsageReportRow }> = ({ tool }) => (
  <span className="tool-usage-name truncate" title={tool.toolName}>
    <span className="font-medium text-nim">{displayToolName(tool)}</span>
    <span className="text-nim-muted"> · {tool.mcpServer ?? 'built-in'}</span>
  </span>
);

const REASON_HINT: Record<ToolConcern['reasons'][number]['kind'], string> = {
  failing: 'Open a session that used it to see the errors. Declined permission prompts count here too.',
  heavy: 'Ask for smaller results: narrower reads, fewer lines, a region instead of a full screenshot.',
};

const ToolConcerns: React.FC<{ concerns: ToolConcern[] }> = ({ concerns }) => {
  if (concerns.length === 0) {
    return (
      <div className="tool-usage-concerns-empty text-sm text-nim-muted">
        Nothing stands out. No tool fails often or returns unusually large results in this range.
      </div>
    );
  }
  return (
    <ul className="tool-usage-concerns m-0 p-0 list-none flex flex-col divide-y divide-[var(--nim-border)]">
      {concerns.map(({ tool, reasons }) => (
        <li key={tool.toolName} className="tool-usage-concern py-2.5 first:pt-0 last:pb-0 flex flex-col gap-1 text-xs">
          <ToolName tool={tool} />
          {reasons.map((reason) => (
            <div key={reason.text} className="tool-usage-concern-reason flex items-baseline gap-2 select-text">
              <span
                className={`shrink-0 w-2 h-2 rounded-full translate-y-[1px] ${
                  reason.kind === 'failing' ? 'bg-[var(--nim-error)]' : 'bg-[var(--nim-warning)]'
                }`}
              />
              <span className="text-nim">{reason.text}</span>
            </div>
          ))}
          <div className="tool-usage-concern-hint pl-4 text-[11px] text-nim-muted">
            {[...new Set(reasons.map((reason) => REASON_HINT[reason.kind]))].join(' ')}
          </div>
        </li>
      ))}
    </ul>
  );
};

export const ToolUsage: React.FC<ToolUsageProps> = ({ workspaceId, sinceMs }) => {
  const [report, setReport] = useState<ToolUsageReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [backfilling, setBackfilling] = useState(false);
  const [showAllTools, setShowAllTools] = useState(false);
  const [sort, setSort] = useState<SortState<ToolSortKey>>({ key: 'count', direction: 'desc' });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const result = (await window.electronAPI.toolUsage.getReport(workspaceId, sinceMs)) as ToolUsageReport;
      setReport(result);
    } catch (error) {
      console.error('[ToolUsage] Failed to load tool usage report:', error);
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, sinceMs]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleBackfill = useCallback(async () => {
    setBackfilling(true);
    try {
      await window.electronAPI.toolUsage.backfill();
      await loadData();
    } catch (error) {
      console.error('[ToolUsage] Backfill failed:', error);
    } finally {
      setBackfilling(false);
    }
  }, [loadData]);

  const toggleSort = (key: ToolSortKey) =>
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === 'desc' ? 'asc' : 'desc' }
        : { key, direction: key === 'name' ? 'asc' : 'desc' },
    );

  const tools = useMemo(() => (report ? mergeToolRows(report) : []), [report]);
  const sortedTools = useMemo(() => {
    const factor = sort.direction === 'asc' ? 1 : -1;
    return [...tools].sort((a, b) =>
      sort.key === 'name'
        ? factor * displayToolName(a).localeCompare(displayToolName(b))
        : factor * (SORT_VALUE[sort.key](a) - SORT_VALUE[sort.key](b)),
    );
  }, [tools, sort]);

  const backfillButton = (
    <button
      type="button"
      onClick={handleBackfill}
      disabled={backfilling}
      className={`tool-usage-backfill shrink-0 text-[11px] px-2 py-1 rounded-sm border border-nim ${
        backfilling ? 'opacity-50 cursor-default' : 'text-nim-muted hover:text-nim'
      }`}
      title="Populate historical tool usage from past claude-code and codex sessions"
    >
      {backfilling ? 'Backfilling...' : 'Backfill history'}
    </button>
  );

  if (loading) {
    return <div className="tool-usage-loading flex items-center justify-center min-h-[300px] text-nim-muted text-base">Loading...</div>;
  }

  const total = report ? report.byKind.builtin + report.byKind.mcp : 0;
  if (!report || total === 0) {
    return (
      <div className="tool-usage-empty flex flex-col items-center justify-center gap-3 min-h-[300px] text-sm text-nim-muted">
        No tool calls recorded in this range. Run an agent session, or import past sessions.
        {backfillButton}
      </div>
    );
  }

  const toolTokens = report.tokens.call + report.tokens.result;
  const concerns = findToolConcerns(tools, toolTokens);
  const visibleTools = showAllTools ? sortedTools : sortedTools.slice(0, TABLE_ROWS);

  const trend = fillDailyCounts(report.overTime, { sinceMs, nowMs: Date.now() });
  const chartData = trend.buckets.map((bucket) => {
    const date = new Date(`${bucket.day}T00:00:00Z`);
    return {
      label: date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }),
      fullLabel: trend.granularity === 'week'
        ? `Week of ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}`
        : date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }),
      count: bucket.count,
    };
  });

  return (
    <div className="tool-usage-report flex flex-col gap-4">
      {/* Backfill fills both counts and token sizes for older sessions, so it
          lives above everything it affects rather than inside one section. */}
      <div className="tool-usage-toolbar flex items-center justify-end gap-3 text-xs text-nim-muted">
        {report.sizeBackfillPending && (
          <span className="tool-usage-backfill-hint">
            Token estimates don&apos;t include older Claude Code and Codex sessions yet.
          </span>
        )}
        {backfillButton}
      </div>
      <StatGrid>
        <StatCard
          label="Tool calls"
          value={formatCompactNumber(total)}
          title={`${total.toLocaleString()} tool calls`}
          // The server returns at most 100 tools per list, so a full list means "at least".
          detail={`${tools.length}${report.topTools.length >= 100 ? '+' : ''} different tools`}
        />
        <StatCard
          label="Built-in tools"
          value={percent(report.byKind.builtin, total)}
          detail={`${formatCompactNumber(report.byKind.mcp)} calls to extension / MCP tools`}
        />
        <StatCard
          label="Failed calls"
          value={percent(report.errorCount, total)}
          detail={`${report.errorCount.toLocaleString()} of ${total.toLocaleString()} calls`}
        />
        <StatCard
          label="Tool tokens"
          value={toolTokens > 0 ? `~${formatCompactNumber(toolTokens)}` : '--'}
          title="Estimated from the size of each call and its result, at about 4 characters per token"
          detail={toolTokens > 0
            ? `${formatCompactNumber(report.tokens.result)} from results · ${formatCompactNumber(report.tokens.call)} from calls`
            : 'No sizes recorded in this range'}
        />
      </StatGrid>

      <ReportSection
        className="tool-usage-attention"
        title="Tools to look at"
        description={`Flagged when at least ${percent(FAIL_RATE, 1)} of calls fail, a call averages over ${formatCompactNumber(HEAVY_PER_CALL_TOKENS)} tokens, or one tool is over ${percent(HEAVY_SHARE, 1)} of tool tokens.`}
      >
        <ToolConcerns concerns={concerns} />
      </ReportSection>

      <ReportSection
        className="tool-usage-table-section"
        title="All tools"
        description="Click a column to sort. Tokens are estimates: what each tool's results add to the conversation, plus what the model writes to call it."
      >
        <table className="tool-usage-table w-full text-xs border-collapse table-fixed">
          <colgroup>
            <col />
            <col className="w-[90px]" />
            <col className="w-[90px]" />
            <col className="w-[100px]" />
            <col className="w-[100px]" />
          </colgroup>
          <thead>
            <tr className="text-left text-nim-muted border-b border-nim">
              <SortableHeader sortKey="name" sort={sort} onSort={toggleSort}>Tool</SortableHeader>
              <SortableHeader sortKey="count" sort={sort} onSort={toggleSort} align="right">Calls</SortableHeader>
              <SortableHeader sortKey="failRate" sort={sort} onSort={toggleSort} align="right">Failed</SortableHeader>
              <SortableHeader sortKey="tokens" sort={sort} onSort={toggleSort} align="right">~Tokens</SortableHeader>
              <SortableHeader sortKey="perCall" sort={sort} onSort={toggleSort} align="right">~Per call</SortableHeader>
            </tr>
          </thead>
          <tbody>
            {visibleTools.map((tool) => {
              const tokens = tokensOf(tool);
              return (
                <tr key={tool.toolName} className="tool-usage-row border-b border-[var(--nim-border)] last:border-b-0 hover:bg-[var(--nim-bg-tertiary)]">
                  <td className="py-1.5 pr-3 truncate"><ToolName tool={tool} /></td>
                  <td className="py-1.5 pr-3 text-right text-nim select-text">{tool.count.toLocaleString()}</td>
                  <td
                    className={`py-1.5 pr-3 text-right select-text ${isFailing(tool) ? 'text-[var(--nim-error)] font-medium' : 'text-nim-muted'}`}
                    title={`${tool.errorCount.toLocaleString()} failed`}
                  >
                    {tool.errorCount > 0 ? percent(tool.errorCount, tool.count) : '--'}
                  </td>
                  <td className="py-1.5 pr-3 text-right text-nim select-text" title={`${Math.round(tokens).toLocaleString()} tokens`}>
                    {tokens > 0 ? formatCompactNumber(tokens) : '--'}
                  </td>
                  <td
                    className={`py-1.5 pr-3 text-right select-text ${isHeavyPerCall(tool) ? 'text-[var(--nim-warning)] font-medium' : 'text-nim-muted'}`}
                  >
                    {tokens > 0 && tool.count > 0 ? formatCompactNumber(perCallOf(tool)) : '--'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {sortedTools.length > TABLE_ROWS && (
          <button
            type="button"
            className="tool-usage-show-all self-start text-xs text-nim-link hover:underline"
            onClick={() => setShowAllTools((value) => !value)}
          >
            {showAllTools ? 'Show fewer' : `Show all ${sortedTools.length}`}
          </button>
        )}
      </ReportSection>

      <ReportSection
        className="tool-usage-over-time"
        title={`Tool calls per ${trend.granularity}`}
        description="Days are in UTC, the way tool calls are recorded."
      >
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--nim-border)" vertical={false} />
            <XAxis dataKey="label" stroke="var(--nim-text-muted)" tick={{ fontSize: 11 }} minTickGap={16} />
            <YAxis stroke="var(--nim-text-muted)" width={48} tick={{ fontSize: 11 }} tickFormatter={formatCompactNumber} allowDecimals={false} />
            <Tooltip
              cursor={{ fill: 'var(--nim-bg-tertiary)' }}
              labelFormatter={(_label, payload) =>
                (payload?.[0]?.payload as { fullLabel?: string } | undefined)?.fullLabel ?? String(_label)
              }
              formatter={(value) => [typeof value === 'number' ? value.toLocaleString() : String(value), 'Tool calls']}
              contentStyle={CHART_TOOLTIP_STYLE}
            />
            <Bar dataKey="count" fill="var(--nim-primary)" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ReportSection>

      <div className="tool-usage-splits grid grid-cols-[repeat(auto-fit,minmax(360px,1fr))] gap-4">
        <ReportSection className="tool-usage-by-provider" title="By provider">
          <RankedBars
            total={total}
            rows={report.byProvider.map((p) => ({
              key: p.provider,
              label: p.provider,
              value: p.count,
              valueLabel: p.count.toLocaleString(),
            }))}
          />
        </ReportSection>
        <ReportSection className="tool-usage-by-project" title="By project">
          <RankedBars
            total={total}
            rows={report.byProject.map((p) => ({
              key: p.projectPath,
              label: displayProjectName(p.projectPath),
              title: p.projectPath,
              value: p.count,
              valueLabel: p.count.toLocaleString(),
            }))}
          />
        </ReportSection>
      </div>
    </div>
  );
};
