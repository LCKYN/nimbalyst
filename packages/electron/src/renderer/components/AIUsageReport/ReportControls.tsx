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
