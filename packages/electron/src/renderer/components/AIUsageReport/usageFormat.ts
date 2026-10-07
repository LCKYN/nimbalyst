/**
 * Number formatting shared by every panel of the AI Usage report, so the same
 * figure never reads `18,448,067` in one place and `18.4M` in the next.
 */

/**
 * `10328471` -> `10.3M`. Recharts gives an axis 60px by default and a raw
 * eight-digit count is wider than that, so unabbreviated ticks were clipped
 * from the left (`2400000` rendered as `400000`).
 */
export function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) return '';
  const abs = Math.abs(value);
  const scaled =
    abs >= 1_000_000_000 ? { n: value / 1_000_000_000, suffix: 'B' }
    : abs >= 1_000_000 ? { n: value / 1_000_000, suffix: 'M' }
    : abs >= 1_000 ? { n: value / 1_000, suffix: 'K' }
    : { n: value, suffix: '' };
  if (!scaled.suffix) return String(Math.round(value));
  // `10.0M` reads as false precision; `10M` is the same number.
  return `${scaled.n.toFixed(1).replace(/\.0$/, '')}${scaled.suffix}`;
}

/** Dollars at the precision a person reads spend at: `$1,234`, `$12.34`, `<$0.01`. */
export function formatUSD(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '$0';
  if (value < 0.01) return '<$0.01';
  if (value >= 1000) return `$${Math.round(value).toLocaleString()}`;
  return `$${value.toFixed(2)}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Past this many days a trend switches to weekly bars; daily ones become unreadable slivers. */
const MAX_DAILY_BUCKETS = 120;

/**
 * A contiguous series of UTC `YYYY-MM-DD` day counts, from the range start (or
 * the first recorded day) to today. A day with nothing recorded is a zero bar,
 * not a gap the chart silently bridges; long spans roll up into Monday-start
 * weeks. Same rules as the Overview's spend trend.
 */
export function fillDailyCounts(
  points: ReadonlyArray<{ day: string; count: number }>,
  range: { sinceMs?: number; nowMs: number },
): { granularity: 'day' | 'week'; buckets: Array<{ day: string; count: number }> } {
  const dayNumber = (key: string) => Math.floor(Date.parse(`${key}T00:00:00Z`) / DAY_MS);
  const known = points.map((p) => ({ day: dayNumber(p.day), count: p.count })).filter((p) => Number.isFinite(p.day));
  if (known.length === 0 && !range.sinceMs) return { granularity: 'day', buckets: [] };

  const first = range.sinceMs ? Math.floor(range.sinceMs / DAY_MS) : Math.min(...known.map((p) => p.day));
  const last = Math.max(Math.floor(range.nowMs / DAY_MS), ...known.map((p) => p.day));
  const granularity = last - first + 1 > MAX_DAILY_BUCKETS ? 'week' : 'day';
  // Day 0 (1970-01-01) was a Thursday.
  const bucketOf = granularity === 'week' ? (day: number) => Math.floor((day + 3) / 7) * 7 - 3 : (day: number) => day;
  const step = granularity === 'week' ? 7 : 1;

  const counts = new Map<number, number>();
  for (let day = bucketOf(first); day <= last; day += step) counts.set(day, 0);
  for (const point of known) {
    const bucket = bucketOf(point.day);
    if (counts.has(bucket)) counts.set(bucket, (counts.get(bucket) ?? 0) + point.count);
  }
  return {
    granularity,
    buckets: [...counts.entries()].map(([day, count]) => ({
      day: new Date(day * DAY_MS).toISOString().slice(0, 10),
      count,
    })),
  };
}

/** Axis ticks: `$1.2K`, `$40`. */
export function formatCompactUSD(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '$0';
  if (Math.abs(value) < 10) return `$${value.toFixed(value < 1 ? 2 : 1).replace(/\.0+$/, '')}`;
  return `$${formatCompactNumber(value)}`;
}
