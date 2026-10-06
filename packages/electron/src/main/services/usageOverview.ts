/**
 * The AI Usage report's Overview, computed in one pass so every panel on it
 * agrees: the headline spend, the trend, the by-model split and the by-project
 * split are all slices of the same per-session amounts, so they sum to each
 * other.
 *
 * Two rules the earlier panels broke, and this module exists to hold:
 *
 * - **Tokens include cached input.** For Claude Code the uncached `inputTokens`
 *   figure is a rounding error next to cache reads; leaving cache out made the
 *   token total look like it was nearly all output.
 * - **Usage lands on the day it happened, not the day the session started.**
 *   Only session-level totals carry cost for every provider, so each session's
 *   amount is spread across the days its prompts were sent, in proportion to how
 *   many were sent each day. A week-long session no longer spikes its first day,
 *   and a "last 7 days" range counts the part of an older session that ran this
 *   week.
 *
 * Pure: the service does the queries, this does the arithmetic.
 */

import { estimateCostUSD } from '@nimbalyst/runtime/ai/pricing/modelPricing';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Past this many days the trend switches to weekly bars; daily ones become unreadable slivers. */
const MAX_DAILY_BUCKETS = 120;

export interface UsageAmount {
  costUSD: number;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
}

export interface SessionUsageSource {
  id: string;
  provider: string;
  model: string | null;
  workspaceId: string | null;
  createdAtMs: number;
  /** Parsed `ai_sessions.metadata`. */
  metadata: Record<string, any> | null;
}

export interface UsageTrendBucket {
  /** Epoch ms of the bucket's local-midnight start. */
  startMs: number;
  costUSD: number;
  totalTokens: number;
}

export interface UsageSlice {
  costUSD: number;
  totalTokens: number;
  sessionCount: number;
  costEstimated: boolean;
}

export interface UsageOverview {
  totals: UsageAmount & {
    totalTokens: number;
    /** Some of the spend comes from the published-price table rather than the provider. */
    costEstimated: boolean;
    /** Sessions with token usage but no price for their model; their spend is missing from `costUSD`. */
    unpricedSessionCount: number;
    /** Sessions with any activity in the range, with or without recorded usage. */
    sessionCount: number;
    projectCount: number;
    activeDays: number;
  };
  granularity: 'day' | 'week';
  trend: UsageTrendBucket[];
  byModel: Array<UsageSlice & { model: string }>;
  byProject: Array<UsageSlice & { workspaceId: string; lastActiveMs: number }>;
}

interface PricedModelAmount {
  model: string;
  amount: UsageAmount;
  costEstimated: boolean;
  unpriced: boolean;
}

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function emptyAmount(): UsageAmount {
  return { costUSD: 0, inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 };
}

function tokensOf(amount: UsageAmount): number {
  return amount.inputTokens + amount.cacheReadTokens + amount.cacheWriteTokens + amount.outputTokens;
}

function addScaled(target: UsageAmount, source: UsageAmount, factor: number): void {
  target.costUSD += source.costUSD * factor;
  target.inputTokens += source.inputTokens * factor;
  target.cacheReadTokens += source.cacheReadTokens * factor;
  target.cacheWriteTokens += source.cacheWriteTokens * factor;
  target.outputTokens += source.outputTokens * factor;
}

function scaled(source: UsageAmount, factor: number): UsageAmount {
  const out = emptyAmount();
  addScaled(out, source, factor);
  return out;
}

function amountFromBucket(bucket: Record<string, unknown>): UsageAmount {
  return {
    costUSD: num(bucket.costUSD),
    inputTokens: num(bucket.inputTokens),
    cacheReadTokens: num(bucket.cacheReadInputTokens),
    cacheWriteTokens: num(bucket.cacheCreationInputTokens),
    outputTokens: num(bucket.outputTokens),
  };
}

/** `claude-code:opus` -> `opus`; `claude-opus-4-8-20260101` -> `claude-opus-4-8`. */
export function displayModelName(model: string): string {
  const colon = model.indexOf(':');
  const bare = colon === -1 ? model : model.slice(colon + 1);
  return bare.replace(/-\d{8}$/, '') || model;
}

/** Fill in a missing cost from the price table; flag what could not be priced. */
function price(model: string, amount: UsageAmount, knownEstimated: boolean): PricedModelAmount {
  if (amount.costUSD > 0 || tokensOf(amount) === 0) {
    return { model, amount, costEstimated: knownEstimated, unpriced: false };
  }
  const estimate = estimateCostUSD(model, {
    inputTokens: amount.inputTokens,
    outputTokens: amount.outputTokens,
    cacheReadInputTokens: amount.cacheReadTokens,
    cacheCreationInputTokens: amount.cacheWriteTokens,
  });
  if (estimate === undefined) return { model, amount, costEstimated: false, unpriced: true };
  return { model, amount: { ...amount, costUSD: estimate }, costEstimated: true, unpriced: false };
}

/**
 * One session's usage, split by model. `null` when the session recorded no usage.
 *
 * The session-level totals are the authority. `byModel` only exists for turns
 * since per-model tracking shipped, so for a session that spans that upgrade
 * its buckets cover part of the session; they are then used for the split
 * alone, not the amount.
 */
export function resolveSessionUsage(session: Pick<SessionUsageSource, 'provider' | 'model' | 'metadata'>): PricedModelAmount[] | null {
  const tokenUsage = session.metadata?.tokenUsage;
  if (!tokenUsage || typeof tokenUsage !== 'object') return null;

  const sessionModel = session.model || session.provider;
  const total = amountFromBucket(tokenUsage);
  const knownEstimated = tokenUsage.costEstimated === true;

  const byModelRaw = tokenUsage.byModel && typeof tokenUsage.byModel === 'object'
    ? Object.entries(tokenUsage.byModel as Record<string, Record<string, unknown>>)
        .filter(([, bucket]) => bucket && typeof bucket === 'object')
        .map(([model, bucket]) => ({ model, amount: amountFromBucket(bucket) }))
    : [];

  if (byModelRaw.length === 0) {
    return [price(sessionModel, total, knownEstimated)];
  }

  const byModelCost = byModelRaw.reduce((sum, entry) => sum + entry.amount.costUSD, 0);
  const coversWholeSession = Math.abs(byModelCost - total.costUSD) <= Math.max(0.01, total.costUSD * 0.01);
  if (coversWholeSession) {
    return byModelRaw.map((entry) => price(entry.model, entry.amount, knownEstimated));
  }

  // Partial coverage: split the session total by each model's share of what
  // was tracked, by cost where there is any, by tokens otherwise.
  const weightOf = byModelCost > 0
    ? (entry: { amount: UsageAmount }) => entry.amount.costUSD / byModelCost
    : (() => {
        const tokenTotal = byModelRaw.reduce((sum, entry) => sum + tokensOf(entry.amount), 0);
        return (entry: { amount: UsageAmount }) =>
          tokenTotal > 0 ? tokensOf(entry.amount) / tokenTotal : 1 / byModelRaw.length;
      })();
  const pricedTotal = price(sessionModel, total, knownEstimated);
  return byModelRaw.map((entry) => ({
    ...pricedTotal,
    model: entry.model,
    amount: scaled(pricedTotal.amount, weightOf(entry)),
  }));
}

/** Local-calendar day number. `timezoneOffsetMinutes` is `Date#getTimezoneOffset()`. */
function localDay(ms: number, timezoneOffsetMinutes: number): number {
  return Math.floor((ms - timezoneOffsetMinutes * 60_000) / DAY_MS);
}

function localDayStartMs(day: number, timezoneOffsetMinutes: number): number {
  return day * DAY_MS + timezoneOffsetMinutes * 60_000;
}

/** Monday-start week containing `day`. Day 0 (1970-01-01) was a Thursday. */
function weekStartDay(day: number): number {
  return Math.floor((day + 3) / 7) * 7 - 3;
}

/**
 * How much of a session falls inside the range: its in-range prompts over all
 * of its prompts. A session with no prompt rows (imported, or predating the
 * message log) is placed on the day it was created. The Overview and the
 * Sessions tab both go through this, which is what makes their totals agree.
 */
export function sessionRangeActivity(
  promptTimes: number[] | undefined,
  createdAtMs: number,
  range: { sinceMs?: number; nowMs: number },
): { share: number; inRangeTimes: number[]; allTimes: number[] } {
  const allTimes = promptTimes && promptTimes.length > 0 ? promptTimes : [createdAtMs];
  const inRangeTimes = allTimes.filter((ms) => ms <= range.nowMs && (!range.sinceMs || ms >= range.sinceMs));
  return { share: inRangeTimes.length / allTimes.length, inRangeTimes, allTimes };
}

export function buildUsageOverview(
  sessions: SessionUsageSource[],
  promptTimesBySession: Map<string, number[]>,
  options: { sinceMs?: number; nowMs: number; timezoneOffsetMinutes: number },
): UsageOverview {
  const { sinceMs, nowMs, timezoneOffsetMinutes } = options;

  const totals = emptyAmount();
  let costEstimated = false;
  let unpricedSessionCount = 0;
  let sessionCount = 0;
  const activeDays = new Set<number>();
  const trendByDay = new Map<number, UsageAmount>();
  const byModel = new Map<string, UsageSlice>();
  const byProject = new Map<string, UsageOverview['byProject'][number]>();

  for (const session of sessions) {
    const { share, inRangeTimes, allTimes: times } = sessionRangeActivity(
      promptTimesBySession.get(session.id),
      session.createdAtMs,
      { sinceMs, nowMs },
    );
    if (inRangeTimes.length === 0) continue;

    sessionCount += 1;
    for (const t of inRangeTimes) activeDays.add(localDay(t, timezoneOffsetMinutes));
    const lastActiveMs = Math.max(...inRangeTimes);

    const workspaceId = session.workspaceId ?? '';
    const project = byProject.get(workspaceId)
      ?? { workspaceId, costUSD: 0, totalTokens: 0, sessionCount: 0, costEstimated: false, lastActiveMs: 0 };
    project.sessionCount += 1;
    project.lastActiveMs = Math.max(project.lastActiveMs, lastActiveMs);
    byProject.set(workspaceId, project);

    const models = resolveSessionUsage(session);
    if (!models) continue;

    const sessionAmount = emptyAmount();
    for (const entry of models) {
      // An unpriced model carries zero cost but its tokens still count.
      addScaled(sessionAmount, entry.amount, 1);
      const name = displayModelName(entry.model);
      const slice = byModel.get(name) ?? { costUSD: 0, totalTokens: 0, sessionCount: 0, costEstimated: false };
      slice.costUSD += entry.amount.costUSD * share;
      slice.totalTokens += tokensOf(entry.amount) * share;
      slice.sessionCount += 1;
      slice.costEstimated ||= entry.costEstimated;
      byModel.set(name, slice);
    }

    const sessionEstimated = models.some((m) => m.costEstimated);
    if (models.some((m) => m.unpriced)) unpricedSessionCount += 1;
    costEstimated ||= sessionEstimated;

    addScaled(totals, sessionAmount, share);
    project.costUSD += sessionAmount.costUSD * share;
    project.totalTokens += tokensOf(sessionAmount) * share;
    project.costEstimated ||= sessionEstimated;

    const perPrompt = 1 / times.length;
    for (const t of inRangeTimes) {
      const day = localDay(t, timezoneOffsetMinutes);
      const bucket = trendByDay.get(day) ?? emptyAmount();
      addScaled(bucket, sessionAmount, perPrompt);
      trendByDay.set(day, bucket);
    }
  }

  // A contiguous axis: a day with no usage is a zero bar, not a gap the chart
  // silently bridges.
  const trend: UsageTrendBucket[] = [];
  let granularity: 'day' | 'week' = 'day';
  const days = [...trendByDay.keys()];
  if (days.length > 0 || sinceMs) {
    const firstDay = sinceMs ? localDay(sinceMs, timezoneOffsetMinutes) : Math.min(...days);
    const lastDay = localDay(nowMs, timezoneOffsetMinutes);
    granularity = lastDay - firstDay + 1 > MAX_DAILY_BUCKETS ? 'week' : 'day';
    const bucketOf = granularity === 'week' ? weekStartDay : (day: number) => day;
    const buckets = new Map<number, UsageTrendBucket>();
    for (let day = bucketOf(firstDay); day <= lastDay; day += granularity === 'week' ? 7 : 1) {
      buckets.set(day, { startMs: localDayStartMs(day, timezoneOffsetMinutes), costUSD: 0, totalTokens: 0 });
    }
    for (const [day, amount] of trendByDay) {
      const bucket = buckets.get(bucketOf(day));
      if (!bucket) continue;
      bucket.costUSD += amount.costUSD;
      bucket.totalTokens += tokensOf(amount);
    }
    trend.push(...buckets.values());
  }

  const byCostThenTokens = (a: UsageSlice, b: UsageSlice) =>
    b.costUSD - a.costUSD || b.totalTokens - a.totalTokens;

  return {
    totals: {
      ...totals,
      totalTokens: tokensOf(totals),
      costEstimated,
      unpricedSessionCount,
      sessionCount,
      projectCount: byProject.size,
      activeDays: activeDays.size,
    },
    granularity,
    trend,
    byModel: [...byModel.entries()].map(([model, slice]) => ({ model, ...slice })).sort(byCostThenTokens),
    byProject: [...byProject.values()].filter((p) => p.totalTokens > 0 || p.costUSD > 0).sort(byCostThenTokens),
  };
}
