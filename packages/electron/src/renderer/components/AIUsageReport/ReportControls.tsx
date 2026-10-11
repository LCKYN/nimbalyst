import React from 'react';

/**
 * The report's one "pick exactly one" control, and its one section heading.
 *
 * Before this the report had three different segmented-control treatments and
 * four heading sizes for panels that sit side by side, which made peer sections
 * read as though they were at different levels of the hierarchy.
 */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label?: string;
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}): React.ReactElement {
  return (
    <div className="report-segmented-control flex items-center gap-2 text-xs">
      {label && <span className="text-nim-muted">{label}</span>}
      <div className="report-segmented-options flex gap-1 rounded-md bg-nim-secondary p-1">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={value === option.value}
            className={`report-segmented-option whitespace-nowrap rounded px-3 py-1 font-medium transition-colors ${
              value === option.value
                ? 'bg-nim text-nim shadow-sm'
                : 'text-nim-muted hover:text-nim'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export const SectionHeading: React.FC<{ children: React.ReactNode; description?: string }> = ({
  children,
  description,
}) => (
  <div className="report-section-heading">
    <h3 className="m-0 text-base font-semibold text-nim">{children}</h3>
    {description && <p className="mt-1 mb-0 text-xs text-nim-muted">{description}</p>}
  </div>
);

/**
 * A boxed report section. Every tab builds from this, StatCard and RankedBars
 * so the three tabs read as one report rather than three.
 */
export const ReportSection: React.FC<{
  className: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}> = ({ className, title, description, actions, children }) => (
  <section className={`${className} report-section bg-nim-secondary border border-nim rounded-md p-4 flex flex-col gap-3 min-w-0`}>
    <div className="report-section-header flex items-start justify-between gap-4">
      <SectionHeading description={description}>{title}</SectionHeading>
      {actions}
    </div>
    {children}
  </section>
);

export const StatCard: React.FC<{ label: string; value: string; detail?: string; title?: string }> = ({
  label,
  value,
  detail,
  title,
}) => (
  <div className="report-stat-card bg-nim-secondary border border-nim rounded-md px-4 py-3" title={title}>
    <div className="report-stat-label text-[11px] text-[var(--nim-text-faint)] uppercase tracking-[0.5px] mb-1 font-medium">
      {label}
    </div>
    <div className="report-stat-value text-2xl font-semibold text-nim mb-0.5 select-text">{value}</div>
    {detail && <div className="report-stat-detail text-[11px] text-nim-muted">{detail}</div>}
  </div>
);

export const StatGrid: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="report-stat-grid grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">{children}</div>
);

export interface RankedBarRow {
  key: string;
  label: string;
  /** Hover text, e.g. the full path behind a shortened project name. */
  title?: string;
  value: number;
  valueLabel: string;
  detail?: string;
  tone?: 'primary' | 'info' | 'error';
}

const TONE_FILL: Record<NonNullable<RankedBarRow['tone']>, string> = {
  primary: 'bg-[var(--nim-primary)]',
  info: 'bg-[var(--nim-info)]',
  error: 'bg-[var(--nim-error)]',
};

/**
 * Bars measured against the whole, not the largest row: a bar's length is its
 * share of `total`, and the percentage beside it says so. Scaling to the top
 * row made the first bar always full, which says nothing.
 */
export const RankedBars: React.FC<{ rows: RankedBarRow[]; total: number; emptyText?: string }> = ({
  rows,
  total,
  emptyText = 'Nothing in this range',
}) => {
  if (rows.length === 0) {
    return <div className="ranked-bars-empty text-sm text-nim-muted">{emptyText}</div>;
  }
  return (
    <div className="ranked-bars flex flex-col gap-2.5">
      {rows.map((row) => {
        const share = total > 0 ? Math.min((row.value / total) * 100, 100) : 0;
        return (
          <div key={row.key} className="ranked-bar flex flex-col gap-1" title={row.title}>
            <div className="flex items-baseline justify-between gap-3 text-xs">
              <span className="ranked-bar-label font-medium text-nim truncate">{row.label}</span>
              <span className="ranked-bar-value shrink-0 text-nim select-text">
                {row.valueLabel}
                <span className="text-nim-muted"> · {share > 0 && share < 1 ? '<1' : Math.round(share)}%</span>
              </span>
            </div>
            <div className="ranked-bar-track h-1.5 bg-[var(--nim-bg-tertiary)] rounded-sm overflow-hidden">
              <div
                className={`ranked-bar-fill h-full rounded-sm transition-[width] duration-300 ease-out ${TONE_FILL[row.tone ?? 'primary']}`}
                style={{ width: `${share}%` }}
              />
            </div>
            {row.detail && <div className="ranked-bar-detail text-[11px] text-nim-muted">{row.detail}</div>}
          </div>
        );
      })}
    </div>
  );
};

export interface SortState<K extends string> {
  key: K;
  direction: 'asc' | 'desc';
}

/** A table column header that sorts by `sortKey` when clicked. */
export function SortableHeader<K extends string>({
  sortKey,
  sort,
  onSort,
  align = 'left',
  className = '',
  children,
}: {
  sortKey: K;
  sort: SortState<K>;
  onSort: (key: K) => void;
  align?: 'left' | 'right';
  className?: string;
  children: React.ReactNode;
}): React.ReactElement {
  const active = sort.key === sortKey;
  return (
    <th
      className={`report-sortable-header py-1.5 pr-3 font-medium cursor-pointer select-none hover:text-nim ${
        align === 'right' ? 'text-right' : ''
      } ${active ? 'text-nim' : ''} ${className}`}
      onClick={() => onSort(sortKey)}
      aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      {children}
      {active ? (sort.direction === 'asc' ? ' ▲' : ' ▼') : ''}
    </th>
  );
}

/** Recharts tooltip styling, shared so every chart's hover card matches. */
export const CHART_TOOLTIP_STYLE: React.CSSProperties = {
  background: 'var(--nim-bg-secondary)',
  border: '1px solid var(--nim-border)',
  borderRadius: '6px',
  color: 'var(--nim-text)',
  fontSize: 12,
};

export type DateRange = 'all' | '7d' | '30d' | '90d';

export const DATE_RANGE_OPTIONS: ReadonlyArray<{ value: DateRange; label: string }> = [
  { value: 'all', label: 'All time' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
];

const DATE_RANGE_DAYS: Record<Exclude<DateRange, 'all'>, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

/**
 * `undefined` for "all time" rather than 0 -- the service treats a falsy
 * `sinceMs` as "no bound", and passing 0 would read as the epoch.
 */
export function sinceMsFor(range: DateRange, now: number = Date.now()): number | undefined {
  if (range === 'all') return undefined;
  return now - DATE_RANGE_DAYS[range] * 24 * 60 * 60 * 1000;
}
