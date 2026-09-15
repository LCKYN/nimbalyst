import React, { useEffect, useState } from 'react';
import { useFloating, offset, flip, shift, FloatingPortal } from '@floating-ui/react';
import { SectionHeading, SegmentedControl } from './ReportControls';

interface ActivityHeatmapProps {
  workspaceId?: string;
  sinceMs?: number;
}

interface ActivityHeatmapData {
  hourOfDay: number;
  dayOfWeek: number;
  activityCount: number;
}

interface TokenHeatmapData {
  hourOfDay: number;
  dayOfWeek: number;
  totalTokens: number;
}

type ActivityMetric = 'sessions' | 'messages' | 'edits';

const METRIC_LABELS: Record<ActivityMetric, { title: string; description: string }> = {
  sessions: {
    title: 'AI Sessions Created',
    description: 'When new AI chat sessions are started',
  },
  messages: {
    title: 'AI Messages Sent',
    description: 'When you send messages to AI',
  },
  edits: {
    title: 'Documents Edited',
    description: 'When documents are saved',
  },
};

export const ActivityHeatmap: React.FC<ActivityHeatmapProps> = ({ workspaceId, sinceMs }) => {
  const [data, setData] = useState<ActivityHeatmapData[]>([]);
  const [tokenData, setTokenData] = useState<TokenHeatmapData[]>([]);
  const [loading, setLoading] = useState(true);
  const [metric, setMetric] = useState<ActivityMetric>('messages');
  // One tooltip for the whole grid, re-anchored to whichever cell is hovered.
  // 168 cells, so a floating instance per cell would be 168 of them mounted.
  const [hoveredCell, setHoveredCell] = useState<{ text: string; rect: DOMRect } | null>(null);

  const { refs, floatingStyles } = useFloating({
    placement: 'top',
    middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
  });

  // A cell's rect is the anchor, not the cell element itself: the cells scale
  // on hover, and `setPositionReference` takes the virtual element. Passing one
  // through `elements.reference` is rejected by floating-ui.
  const { setPositionReference } = refs;
  useEffect(() => {
    if (!hoveredCell) return;
    setPositionReference({ getBoundingClientRect: () => hoveredCell.rect });
  }, [hoveredCell, setPositionReference]);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        // Get user's timezone offset in minutes (e.g., -300 for EST)
        const timezoneOffsetMinutes = new Date().getTimezoneOffset();

        const heatmapData = await window.electronAPI.invoke(
          'usage-analytics:get-activity-heatmap',
          workspaceId,
          metric,
          timezoneOffsetMinutes,
          sinceMs
        );
        setData(heatmapData);
      } catch (error) {
        console.error('Failed to load activity heatmap:', error);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [workspaceId, metric, sinceMs]);

  // Deliberately a separate load, not part of the one above. Tokens come from a
  // scan of the raw message log, which is far slower than counting timestamps --
  // gating the grid on it would leave the whole heatmap blank meanwhile. The
  // readout picks tokens up when they arrive and reads fine without them.
  // Metric-independent: the hour's token cost is the same whichever count the
  // cells are showing.
  useEffect(() => {
    let cancelled = false;
    const loadTokens = async () => {
      try {
        const result = await window.electronAPI.invoke(
          'usage-analytics:get-token-heatmap',
          workspaceId,
          new Date().getTimezoneOffset(),
          sinceMs,
        );
        if (!cancelled) setTokenData(Array.isArray(result) ? result : []);
      } catch (error) {
        console.error('Failed to load token heatmap:', error);
        if (!cancelled) setTokenData([]);
      }
    };
    void loadTokens();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, sinceMs]);

  if (loading) {
    return (
      <div className="activity-heatmap-loading flex items-center justify-center min-h-[200px] text-[var(--nim-text-muted)] text-sm">
        Loading...
      </div>
    );
  }

  // Create a 2D grid: rows = days (0-6), columns = hours (0-23)
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // Find max activity for scaling
  const maxActivity = Math.max(...data.map((d) => d.activityCount), 1);

  // Create lookup map
  const activityMap = new Map<string, number>();
  data.forEach((d) => {
    const key = `${d.dayOfWeek}-${d.hourOfDay}`;
    activityMap.set(key, d.activityCount);
  });

  const tokenMap = new Map<string, number>();
  tokenData.forEach((d) => {
    tokenMap.set(`${d.dayOfWeek}-${d.hourOfDay}`, d.totalTokens);
  });

  const getIntensity = (dayOfWeek: number, hour: number): number => {
    const key = `${dayOfWeek}-${hour}`;
    const count = activityMap.get(key) || 0;
    return count / maxActivity;
  };

  const currentMetricLabels = METRIC_LABELS[metric];

  return (
    <div className="activity-heatmap flex flex-col gap-3">
      <div className="heatmap-header-section flex justify-between items-start gap-4">
        <SectionHeading description={currentMetricLabels.description}>
          {currentMetricLabels.title}
        </SectionHeading>
        <SegmentedControl
          options={(['messages', 'edits', 'sessions'] as ActivityMetric[]).map((value) => ({
            value,
            label: METRIC_LABELS[value].title.replace(/^(AI |Documents )/g, ''),
          }))}
          value={metric}
          onChange={setMetric}
        />
      </div>

      <div className="heatmap-container overflow-x-auto">
        <div className="heatmap-grid inline-block min-w-[800px]">
          {/* Header row with hour labels */}
          <div className="heatmap-header grid grid-cols-[40px_repeat(24,1fr)] gap-0.5 mb-0.5">
            <div className="day-label text-[10px] font-semibold text-[var(--nim-text)] text-right pr-2 flex items-center justify-end"></div>
            {hours.map((hour) => (
              <div
                key={hour}
                className="hour-label text-[9px] text-[var(--nim-text-faint)] text-center flex items-center justify-center"
              >
                {hour.toString().padStart(2, '0')}
              </div>
            ))}
          </div>

          {/* Data rows - one per day */}
          {days.map((day, dayIndex) => (
            <div key={dayIndex} className="heatmap-row grid grid-cols-[40px_repeat(24,1fr)] gap-0.5 mb-0.5">
              <div className="day-label text-[10px] font-semibold text-[var(--nim-text)] text-right pr-2 flex items-center justify-end">
                {day}
              </div>
              {hours.map((hour) => {
                const intensity = getIntensity(dayIndex, hour);
                const count = activityMap.get(`${dayIndex}-${hour}`) || 0;
                const tooltipText = (() => {
                  if (metric === 'messages') return `${count} message${count !== 1 ? 's' : ''} sent`;
                  if (metric === 'edits') return `${count} edit${count !== 1 ? 's' : ''} saved`;
                  return `${count} session${count !== 1 ? 's' : ''} started`;
                })();
                const tokensThisHour = tokenMap.get(`${dayIndex}-${hour}`);
                const cellLabel =
                  `${day} ${hour.toString().padStart(2, '0')}:00 - ${tooltipText}` +
                  // Omitted entirely rather than shown as 0 while the scan is
                  // still running -- "0 tokens" and "not loaded yet" must not
                  // look the same.
                  (tokensThisHour ? ` · ${tokensThisHour.toLocaleString()} tokens` : '');
                return (
                  <div
                    key={hour}
                    className="heatmap-cell aspect-square rounded-sm bg-nim border border-nim cursor-pointer transition-all duration-200 flex items-center justify-center min-h-[24px] max-h-[32px] relative hover:scale-110 hover:z-10 hover:border-nim"
                    style={{
                      // `color-mix` rather than a literal rgba: the cells and
                      // the legend below must be the same colour, and both must
                      // follow the theme. The old literal happened to equal
                      // --nim-primary in the default dark theme and nowhere else.
                      backgroundColor:
                        intensity > 0
                          ? `color-mix(in srgb, var(--nim-primary) ${Math.round(intensity * 80)}%, transparent)`
                          : undefined,
                    }}
                    onMouseEnter={(event) =>
                      setHoveredCell({
                        text: cellLabel,
                        rect: event.currentTarget.getBoundingClientRect(),
                      })
                    }
                    onMouseLeave={() => setHoveredCell(null)}
                    // Empty cells carry a count of zero rather than no reading at
                    // all, which is the thing the grid alone cannot express.
                    aria-label={cellLabel}
                  >
                    {count > 0 && (
                      <span className="cell-count text-[11px] font-semibold text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.5)]">
                        {count}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        <div className="heatmap-legend flex items-center gap-1.5 mt-2 justify-center text-[10px] text-[var(--nim-text-muted)]">
          <span>Less</span>
          <div
            className="legend-gradient w-[100px] h-2 rounded-sm"
            style={{
              // `--nim-accent-rgb` was never defined, which made the whole
              // rgba() invalid and left this bar blank.
              background:
                'linear-gradient(to right, transparent, color-mix(in srgb, var(--nim-primary) 80%, transparent))',
            }}
          ></div>
          <span>More</span>
        </div>
      </div>

      {/* Portalled so the heatmap's own `overflow-x-auto` cannot clip it. */}
      {hoveredCell && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            role="tooltip"
            className="heatmap-cell-tooltip z-50 pointer-events-none rounded-md border border-nim bg-[var(--nim-bg-secondary)] px-2 py-1 text-xs text-[var(--nim-text)] shadow-md whitespace-nowrap"
          >
            {hoveredCell.text}
          </div>
        </FloatingPortal>
      )}
    </div>
  );
};
