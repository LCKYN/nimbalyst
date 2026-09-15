import React, { useEffect, useMemo, useState } from 'react';
import {
  SegmentedControl,
  DATE_RANGE_OPTIONS,
  sinceMsFor,
  type DateRange,
} from './ReportControls';
import { OverviewDashboard } from './OverviewDashboard';
import { HistoricalGraph } from './HistoricalGraph';
import { ModelComparison } from './ModelComparison';
import { ProjectInsights } from './ProjectInsights';
import { ActivityHeatmap } from './ActivityHeatmap';
import { ToolUsage } from './ToolUsage';
import { SessionsBreakdown } from './SessionsBreakdown';

interface AIUsageReportProps {
  onClose?: () => void;
}

const TAB_LABELS = {
  overview: 'Overview',
  sessions: 'Sessions',
  tools: 'Tools',
} as const;

export const AIUsageReport: React.FC<AIUsageReportProps> = ({ onClose }) => {
  const [workspaceFilter, setWorkspaceFilter] = useState<string | undefined>(undefined);
  const [activeTab, setActiveTab] = useState<'overview' | 'sessions' | 'tools'>('overview');
  const [dateRange, setDateRange] = useState<DateRange>('all');
  const [workspaces, setWorkspaces] = useState<string[]>([]);

  // One bound, shared by every panel. Each used to scope itself -- the Sessions
  // table, the historical graph and the heatmap could show three different
  // periods side by side with nothing saying so.
  const sinceMs = useMemo(() => sinceMsFor(dateRange), [dateRange]);

  // The workspace list comes from the projects aggregate rather than the
  // workspace store: this report only ever wants workspaces that actually have
  // recorded usage, and listing empty ones would offer filters that show nothing.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const projects = await window.electronAPI.invoke('usage-analytics:get-usage-by-project');
        if (!cancelled && Array.isArray(projects)) {
          setWorkspaces(projects.map((p: { workspaceId: string }) => p.workspaceId).filter(Boolean));
        }
      } catch (error) {
        console.error('[AIUsageReport] Failed to load workspace list:', error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="ai-usage-report flex flex-col h-full bg-nim text-nim overflow-hidden">
      <div className="ai-usage-report-scope flex flex-wrap items-center justify-end gap-3 px-4 pt-4">
        <label className="ai-usage-report-workspace flex items-center gap-2 text-xs">
          <span className="text-nim-muted">Workspace</span>
          <select
            className="rounded-sm border border-nim bg-nim-secondary px-2 py-1 text-nim"
            value={workspaceFilter ?? ''}
            onChange={(e) => setWorkspaceFilter(e.target.value || undefined)}
          >
            <option value="">All workspaces</option>
            {workspaces.map((id) => (
              <option key={id} value={id}>
                {id.split('/').pop() || id}
              </option>
            ))}
          </select>
        </label>
        <SegmentedControl
          label="Range"
          options={DATE_RANGE_OPTIONS}
          value={dateRange}
          onChange={setDateRange}
        />
      </div>
      <div
        className="ai-usage-report-tabs flex gap-1 px-4 pt-2 border-b border-nim"
        role="tablist"
        aria-label="AI usage report sections"
      >
        {(Object.keys(TAB_LABELS) as Array<keyof typeof TAB_LABELS>).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            onClick={() => setActiveTab(tab)}
            className={`ai-usage-report-tab px-3 py-2 text-sm border-b-2 ${
              activeTab === tab
                ? 'border-[var(--nim-primary)] text-[var(--nim-text)]'
                : 'border-transparent text-[var(--nim-text-muted)] hover:text-[var(--nim-text)]'
            }`}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>
      <div className="ai-usage-report-content flex-1 overflow-y-auto p-4 flex flex-col gap-4 scrollbar-nim">
        {activeTab === 'overview' ? (
          <>
            <OverviewDashboard workspaceId={workspaceFilter} sinceMs={sinceMs} />

            <div className="dashboard-row grid grid-cols-[repeat(auto-fit,minmax(500px,1fr))] gap-4">
              <div className="dashboard-section bg-nim-secondary border border-nim rounded-md p-4">
                <ActivityHeatmap workspaceId={workspaceFilter} sinceMs={sinceMs} />
              </div>
            </div>

            <div className="dashboard-row grid grid-cols-[repeat(auto-fit,minmax(500px,1fr))] gap-4">
              <div className="dashboard-section bg-nim-secondary border border-nim rounded-md p-4">
                <HistoricalGraph workspaceId={workspaceFilter} sinceMs={sinceMs} />
              </div>
              <div className="dashboard-section bg-nim-secondary border border-nim rounded-md p-4">
                <ModelComparison workspaceId={workspaceFilter} sinceMs={sinceMs} />
              </div>
            </div>

            <div className="dashboard-row grid grid-cols-[repeat(auto-fit,minmax(500px,1fr))] gap-4">
              <div className="dashboard-section bg-nim-secondary border border-nim rounded-md p-4">
                <ProjectInsights sinceMs={sinceMs} />
              </div>
            </div>
          </>
        ) : activeTab === 'sessions' ? (
          <div className="dashboard-row grid grid-cols-[repeat(auto-fit,minmax(500px,1fr))] gap-4">
            <div className="dashboard-section bg-nim-secondary border border-nim rounded-md p-4">
              <SessionsBreakdown workspaceId={workspaceFilter} sinceMs={sinceMs} />
            </div>
          </div>
        ) : (
          <div className="dashboard-row grid grid-cols-[repeat(auto-fit,minmax(500px,1fr))] gap-4">
            <div className="dashboard-section bg-nim-secondary border border-nim rounded-md p-4">
              <ToolUsage workspaceId={workspaceFilter} sinceMs={sinceMs} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
