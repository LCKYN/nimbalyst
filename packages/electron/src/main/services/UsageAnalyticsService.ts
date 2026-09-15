/**
 * Usage Analytics Service
 * Provides aggregated statistics for AI usage and document editing patterns
 */

import type { AppDatabase } from '../database/PGLiteDatabaseWorker';

export interface TokenUsageStats {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  sessionCount: number;
  messageCount: number;
}

export interface ProviderUsageStats {
  provider: string;
  model: string | null;
  sessionCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
}

export interface ProjectUsageStats {
  workspaceId: string;
  sessionCount: number;
  totalTokens: number;
  lastActivity: number;
}

export interface TimeSeriesDataPoint {
  timestamp: number; // Epoch milliseconds
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  sessionCount: number;
}

export interface ActivityHeatmapData {
  hourOfDay: number; // 0-23
  dayOfWeek: number; // 0-6 (Sunday-Saturday)
  activityCount: number;
}

export interface TokenHeatmapData {
  hourOfDay: number; // 0-23
  dayOfWeek: number; // 0-6 (Sunday-Saturday)
  totalTokens: number;
}

export interface DocumentEditStats {
  workspaceId: string;
  filePath: string;
  editCount: number;
  lastEdited: number;
  sizeBytes: number;
}

/** A tokens/cost bucket surfaced in the Sessions breakdown (main/subagent/per-model). */
export interface TokenUsageBucketRow {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  costUSD?: number;
}

/**
 * One session's usage row for the AI Usage Report "Sessions" tab (#1496).
 * `workstreamRootId` groups a hierarchical parent/child workstream under one
 * id (the top-most ancestor) so the UI can roll up cost across a workstream
 * without a second round-trip.
 */
export interface SessionUsageBreakdownRow {
  id: string;
  title: string;
  provider: string;
  model: string | null;
  phase?: string;
  tags?: string[];
  parentSessionId: string | null;
  createdBySessionId: string | null;
  workstreamRootId: string;
  /** The workspace path, so the report can open the session in the right window. */
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

export class UsageAnalyticsService {
  constructor(private db: AppDatabase) {}

  private isSQLiteBackend(): boolean {
    const candidate = this.db as AppDatabase & { getEngine?: () => string };
    return candidate.getEngine?.() === 'sqlite';
  }

  private readonly SESSION_TOKEN_USAGE_CTE = `
    WITH session_token_usage AS (
      SELECT
        s.id,
        s.provider,
        s.model,
        s.workspace_id,
        s.created_at,
        s.updated_at,
        COALESCE((s.metadata->'tokenUsage'->>'inputTokens')::bigint, 0) AS input_tokens,
        COALESCE((s.metadata->'tokenUsage'->>'outputTokens')::bigint, 0) AS output_tokens,
        COALESCE(
          (s.metadata->'tokenUsage'->>'totalTokens')::bigint,
          COALESCE((s.metadata->'tokenUsage'->>'inputTokens')::bigint, 0) +
          COALESCE((s.metadata->'tokenUsage'->>'outputTokens')::bigint, 0),
          0
        ) AS total_tokens
      FROM ai_sessions s
      WHERE s.metadata->'tokenUsage' IS NOT NULL
    )
  `;

  /**
   * Get total count of all AI sessions (including those without token data)
   */
  /**
   * Outer WHERE for the session-scoped aggregates, so every panel in the report
   * can be scoped to the same workspace and the same period.
   *
   * The date bound goes on the outer query rather than inside
   * SESSION_TOKEN_USAGE_CTE: that string is shared by four callers with
   * different parameter counts, and threading a placeholder through it would
   * make the numbering depend on which caller you were reading.
   *
   * `to_timestamp` is portable -- SQLiteDatabase registers it as a UDF, so this
   * is one dialect, not two.
   */
  private sessionScope(workspaceId?: string, sinceMs?: number): { clause: string; params: any[] } {
    const conditions: string[] = [];
    const params: any[] = [];
    if (workspaceId) {
      params.push(workspaceId);
      conditions.push(`workspace_id = $${params.length}`);
    }
    if (sinceMs) {
      params.push(sinceMs);
      conditions.push(`created_at >= to_timestamp($${params.length} / 1000.0)`);
    }
    return { clause: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', params };
  }

  async getAllSessionCount(workspaceId?: string, sinceMs?: number): Promise<number> {
    const { clause: whereClause, params } = this.sessionScope(workspaceId, sinceMs);

    const result = await this.db.query(
      `SELECT COUNT(DISTINCT id) as total_sessions
      FROM ai_sessions
      ${whereClause}`,
      params
    );

    return parseInt(result.rows[0]?.total_sessions) || 0;
  }

  /**
   * Get overall token usage statistics across all sessions
   */
  async getOverallTokenUsage(workspaceId?: string, sinceMs?: number): Promise<TokenUsageStats> {
    const { clause: whereClause, params } = this.sessionScope(workspaceId, sinceMs);

    const result = await this.db.query(
      `${this.SESSION_TOKEN_USAGE_CTE}
      SELECT
        COALESCE(SUM(input_tokens), 0) as total_input_tokens,
        COALESCE(SUM(output_tokens), 0) as total_output_tokens,
        COALESCE(SUM(total_tokens), 0) as total_tokens,
        COUNT(DISTINCT id) as session_count
      FROM session_token_usage
      ${whereClause}`,
      params
    );

    const row = result.rows[0] || {};

    return {
      totalInputTokens: parseInt(row.total_input_tokens) || 0,
      totalOutputTokens: parseInt(row.total_output_tokens) || 0,
      totalTokens: parseInt(row.total_tokens) || 0,
      sessionCount: parseInt(row.session_count) || 0,
      messageCount: 0, // TODO: Can be calculated from ai_agent_messages if needed
    };
  }

  /**
   * Get token usage broken down by provider and model
   */
  async getUsageByProvider(workspaceId?: string, sinceMs?: number): Promise<ProviderUsageStats[]> {
    const { clause: whereClause, params } = this.sessionScope(workspaceId, sinceMs);

    const result = await this.db.query(
      `${this.SESSION_TOKEN_USAGE_CTE}
      SELECT
        provider,
        model,
        COUNT(DISTINCT id) as session_count,
        COALESCE(SUM(input_tokens), 0) as total_input_tokens,
        COALESCE(SUM(output_tokens), 0) as total_output_tokens,
        COALESCE(SUM(total_tokens), 0) as total_tokens
      FROM session_token_usage
      ${whereClause}
      GROUP BY provider, model
      ORDER BY total_tokens DESC`,
      params
    );

    return result.rows.map((row: any) => ({
      provider: row.provider,
      model: row.model,
      sessionCount: parseInt(row.session_count) || 0,
      totalInputTokens: parseInt(row.total_input_tokens) || 0,
      totalOutputTokens: parseInt(row.total_output_tokens) || 0,
      totalTokens: parseInt(row.total_tokens) || 0,
    }));
  }

  /**
   * Get token usage broken down by project (workspace)
   */
  async getUsageByProject(sinceMs?: number): Promise<ProjectUsageStats[]> {
    // Deliberately no workspace scope: this panel exists to compare workspaces.
    const { clause: whereClause, params } = this.sessionScope(undefined, sinceMs);
    const result = await this.db.query(
      `${this.SESSION_TOKEN_USAGE_CTE}
      SELECT
        workspace_id,
        COUNT(DISTINCT id) as session_count,
        COALESCE(SUM(total_tokens), 0) as total_tokens,
        MAX(updated_at) as last_activity_at
      FROM session_token_usage
      ${whereClause}
      GROUP BY workspace_id
      ORDER BY total_tokens DESC`,
      params
    );

    return result.rows.map((row: any) => ({
      workspaceId: row.workspace_id,
      sessionCount: parseInt(row.session_count) || 0,
      totalTokens: parseInt(row.total_tokens) || 0,
      lastActivity: toEpochMs(row.last_activity_at) || Date.now(),
    }));
  }

  /**
   * Per-task/session usage breakdown for the AI Usage Report "Sessions" tab
   * (#1496): tokens, cost (SDK-exact or pricing-table estimate), cache
   * read/write, main-vs-subagent split, and per-model breakdown, plus enough
   * of the hierarchy to roll a workstream's children up under one root.
   *
   * The parent/child walk happens here in JS, not a recursive SQL CTE --
   * consistent with `getTimeSeriesDataPortable`'s existing bias towards JS-side
   * aggregation once the query stops being a genuinely SQL-divergent operation
   * (date truncation is; a parent-pointer walk isn't, so there's no reason to
   * maintain two SQL dialects for it).
   */
  async getSessionUsageBreakdown(workspaceId?: string, sinceMs?: number): Promise<SessionUsageBreakdownRow[]> {
    const { clause: whereClause, params } = this.sessionScope(workspaceId, sinceMs);

    const result = await this.db.query<{
      id: string;
      title: string;
      provider: string;
      model: string | null;
      workspace_id: string | null;
      parent_session_id: string | null;
      created_by_session_id: string | null;
      created_at: unknown;
      updated_at: unknown;
      metadata: unknown;
    }>(
      `SELECT id, title, provider, model, workspace_id, parent_session_id, created_by_session_id,
              created_at, updated_at, metadata
       FROM ai_sessions
       ${whereClause}`,
      params,
    );

    // Parent lookup for the workstream-root walk. Only sessions in THIS result
    // set (i.e. this workspace, when filtered) count as resolvable ancestors --
    // a parent outside the filtered set is treated as the root itself.
    const parentById = new Map<string, string | null>();
    for (const row of result.rows) {
      parentById.set(row.id, row.parent_session_id ?? null);
    }

    const resolveWorkstreamRootId = (id: string): string => {
      const seen = new Set<string>([id]);
      let current = id;
      for (;;) {
        const parent = parentById.get(current);
        if (!parent || !parentById.has(parent) || seen.has(parent)) return current;
        seen.add(parent);
        current = parent;
      }
    };

    const rows: SessionUsageBreakdownRow[] = result.rows.map((row) => {
      const metadata = parseJsonRecord(row.metadata) ?? {};
      const tokenUsageRaw = metadata.tokenUsage;
      const tokenUsage: Record<string, unknown> =
        tokenUsageRaw && typeof tokenUsageRaw === 'object' ? tokenUsageRaw as Record<string, unknown> : {};

      const inputTokens = Number(tokenUsage.inputTokens ?? 0) || 0;
      const outputTokens = Number(tokenUsage.outputTokens ?? 0) || 0;
      const totalTokens = Number(tokenUsage.totalTokens ?? inputTokens + outputTokens) || 0;
      const costUSD = Number(tokenUsage.costUSD ?? 0) || 0;

      return {
        id: row.id,
        title: row.title || 'Untitled Session',
        provider: row.provider,
        model: row.model ?? null,
        phase: typeof metadata.phase === 'string' ? metadata.phase : undefined,
        tags: Array.isArray(metadata.tags) ? metadata.tags as string[] : undefined,
        parentSessionId: row.parent_session_id ?? null,
        createdBySessionId: row.created_by_session_id ?? null,
        workstreamRootId: resolveWorkstreamRootId(row.id),
        workspaceId: row.workspace_id ?? null,
        inputTokens,
        outputTokens,
        totalTokens,
        costUSD,
        costEstimated: tokenUsage.costEstimated === true,
        mainUsage: normalizeTokenUsageBucket(tokenUsage.mainUsage),
        subagentUsage: normalizeTokenUsageBucket(tokenUsage.subagentUsage),
        byModel: normalizeTokenUsageByModel(tokenUsage.byModel),
        cacheReadInputTokens: Number(tokenUsage.cacheReadInputTokens ?? 0) || 0,
        cacheCreationInputTokens: Number(tokenUsage.cacheCreationInputTokens ?? 0) || 0,
        createdAt: toEpochMs(row.created_at) || 0,
        updatedAt: toEpochMs(row.updated_at) || 0,
      };
    });

    rows.sort((a, b) => b.costUSD - a.costUSD);
    return rows;
  }

  /**
   * Get time-series data for token usage over a date range
   * @param startDate - Start of range (epoch ms)
   * @param endDate - End of range (epoch ms)
   * @param granularity - 'hour' | 'day' | 'week' | 'month'
   */
  async getTimeSeriesData(
    startDate: number,
    endDate: number,
    granularity: 'hour' | 'day' | 'week' | 'month' = 'day',
    workspaceId?: string
  ): Promise<TimeSeriesDataPoint[]> {
    if (this.isSQLiteBackend()) {
      return this.getTimeSeriesDataPortable(startDate, endDate, granularity, workspaceId);
    }

    const truncFunc = {
      hour: 'hour',
      day: 'day',
      week: 'week',
      month: 'month',
    }[granularity];

    const params = workspaceId ? [startDate, endDate, workspaceId] : [startDate, endDate];

    const timeRangeClause = `created_at >= to_timestamp($1 / 1000.0) AND created_at <= to_timestamp($2 / 1000.0)`;
    const nonCodexWhereClause = workspaceId
      ? `WHERE provider <> 'openai-codex' AND workspace_id = $3 AND ${timeRangeClause}`
      : `WHERE provider <> 'openai-codex' AND ${timeRangeClause}`;
    const codexWorkspaceFilter = workspaceId ? `AND s.workspace_id = $3` : '';

    const result = await this.db.query(
      `${this.SESSION_TOKEN_USAGE_CTE}
      , non_codex_bucketed AS (
        SELECT
          DATE_TRUNC('${truncFunc}', created_at) AS bucket,
          COALESCE(SUM(input_tokens), 0)::bigint AS input_tokens,
          COALESCE(SUM(output_tokens), 0)::bigint AS output_tokens,
          COALESCE(SUM(total_tokens), 0)::bigint AS total_tokens,
          COUNT(DISTINCT id)::bigint AS session_count
        FROM session_token_usage
        ${nonCodexWhereClause}
        GROUP BY DATE_TRUNC('${truncFunc}', created_at)
      )
      , codex_turns_raw AS (
        SELECT
          m.session_id,
          m.created_at,
          s.provider_session_id,
          GREATEST(
            COALESCE((m.content::jsonb->'usage'->>'input_tokens')::bigint, 0) -
            COALESCE((m.content::jsonb->'usage'->>'cached_input_tokens')::bigint, 0),
            0
          ) AS input_tokens,
          COALESCE((m.content::jsonb->'usage'->>'output_tokens')::bigint, 0) AS output_tokens
        FROM ai_agent_messages m
        JOIN ai_sessions s ON s.id = m.session_id
        WHERE s.provider = 'openai-codex'
          ${codexWorkspaceFilter}
          AND m.direction = 'output'
          AND m.metadata->>'eventType' = 'turn.completed'
      )
      , codex_turns AS (
        SELECT
          tr.session_id,
          tr.created_at,
          tr.provider_session_id,
          tr.input_tokens,
          tr.output_tokens
        FROM codex_turns_raw tr
        LEFT JOIN LATERAL (
          SELECT mi.metadata
          FROM ai_agent_messages mi
          WHERE mi.session_id = tr.session_id
            AND mi.direction = 'input'
            AND mi.created_at <= tr.created_at
          ORDER BY mi.created_at DESC
          LIMIT 1
        ) nearest_input ON TRUE
        WHERE COALESCE(nearest_input.metadata->>'promptType', '') <> 'system_reminder'
      )
      , codex_first_turn AS (
        SELECT
          session_id,
          MIN(created_at) AS first_turn_at
        FROM codex_turns
        GROUP BY session_id
      )
      , codex_baseline AS (
        SELECT
          ft.session_id,
          COALESCE(prev.input_tokens, 0) AS baseline_input_tokens,
          COALESCE(prev.output_tokens, 0) AS baseline_output_tokens
        FROM codex_first_turn ft
        JOIN ai_sessions s ON s.id = ft.session_id
        LEFT JOIN LATERAL (
          SELECT
            ct_prev.input_tokens,
            ct_prev.output_tokens
          FROM codex_turns ct_prev
          WHERE ct_prev.provider_session_id = s.provider_session_id
            AND ct_prev.created_at < ft.first_turn_at
          ORDER BY ct_prev.created_at DESC
          LIMIT 1
        ) prev ON TRUE
      )
      , codex_turns_with_prev AS (
        SELECT
          ct.session_id,
          ct.created_at,
          GREATEST(
            ct.input_tokens - COALESCE(
              LAG(ct.input_tokens) OVER (PARTITION BY ct.session_id ORDER BY ct.created_at),
              cb.baseline_input_tokens,
              0
            ),
            0
          ) AS input_tokens,
          GREATEST(
            ct.output_tokens - COALESCE(
              LAG(ct.output_tokens) OVER (PARTITION BY ct.session_id ORDER BY ct.created_at),
              cb.baseline_output_tokens,
              0
            ),
            0
          ) AS output_tokens
        FROM codex_turns ct
        LEFT JOIN codex_baseline cb ON cb.session_id = ct.session_id
      )
      , codex_bucketed AS (
        SELECT
          DATE_TRUNC('${truncFunc}', created_at) AS bucket,
          COALESCE(SUM(input_tokens), 0)::bigint AS input_tokens,
          COALESCE(SUM(output_tokens), 0)::bigint AS output_tokens,
          COALESCE(SUM(input_tokens + output_tokens), 0)::bigint AS total_tokens,
          COUNT(DISTINCT session_id)::bigint AS session_count
        FROM codex_turns_with_prev
        WHERE ${timeRangeClause}
        GROUP BY DATE_TRUNC('${truncFunc}', created_at)
      )
      , combined AS (
        SELECT * FROM non_codex_bucketed
        UNION ALL
        SELECT * FROM codex_bucketed
      )
      SELECT
        EXTRACT(EPOCH FROM bucket) * 1000 as timestamp,
        COALESCE(SUM(input_tokens), 0) as input_tokens,
        COALESCE(SUM(output_tokens), 0) as output_tokens,
        COALESCE(SUM(total_tokens), 0) as total_tokens,
        COALESCE(SUM(session_count), 0) as session_count
      FROM combined
      GROUP BY bucket
      ORDER BY timestamp ASC`,
      params
    );

    return result.rows.map((row: any) => ({
      timestamp: parseFloat(row.timestamp),
      inputTokens: parseInt(row.input_tokens) || 0,
      outputTokens: parseInt(row.output_tokens) || 0,
      totalTokens: parseInt(row.total_tokens) || 0,
      sessionCount: parseInt(row.session_count) || 0,
    }));
  }

  /**
   * Get activity heatmap data (hour of day x day of week)
   * @param workspaceId - Optional workspace filter
   * @param metric - Type of activity to track: sessions, messages, or edits
   * @param timezoneOffsetMinutes - User's timezone offset in minutes (e.g., -300 for EST)
   */
  /**
   * Tokens per weekday/hour bucket, for the activity heatmap's hover readout.
   *
   * There is no token column anywhere -- per-turn usage only exists inside the
   * raw provider frame kept in `ai_agent_messages.content`. That frame's `usage`
   * is the turn's OWN totals (MessageStreamingHandler adds it to the session's
   * running total rather than replacing it), so bucketing by `created_at` and
   * summing is correct; no cumulative differencing is needed here.
   *
   * The `LIKE` prefilter matters: it keeps `JSON.parse` off the overwhelming
   * majority of rows, which on a multi-hundred-MB message log is the difference
   * between a scan and a stall. Callers should treat this as best-effort and
   * render without it if it fails -- see SessionsBreakdown's sibling loader.
   */
  async getTokenHeatmap(
    workspaceId?: string,
    timezoneOffsetMinutes: number = 0,
    sinceMs?: number,
  ): Promise<TokenHeatmapData[]> {
    const offsetMs = -timezoneOffsetMinutes * 60_000;

    const conditions = [`direction = 'output'`, `content LIKE '%"usage"%'`];
    const params: any[] = [];
    if (workspaceId) {
      params.push(workspaceId);
      conditions.push(`session_id IN (SELECT id FROM ai_sessions WHERE workspace_id = $${params.length})`);
    }
    if (sinceMs) {
      params.push(sinceMs);
      conditions.push(`created_at >= to_timestamp($${params.length} / 1000.0)`);
    }
    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const result = await this.db.query<{ created_at: unknown; content: unknown }>(
      `SELECT created_at, content FROM ai_agent_messages ${whereClause}`,
      params,
    );

    const buckets = new Map<string, number>();
    for (const row of result.rows) {
      const ms = toEpochMs(row.created_at);
      if (!Number.isFinite(ms)) continue;
      const usage = readTurnUsage(row.content);
      if (!usage) continue;
      const shifted = new Date(ms + offsetMs);
      const key = `${shifted.getUTCDay()}:${shifted.getUTCHours()}`;
      buckets.set(key, (buckets.get(key) ?? 0) + usage.inputTokens + usage.outputTokens);
    }

    const out: TokenHeatmapData[] = [];
    for (const [key, totalTokens] of buckets) {
      const [dowStr, hourStr] = key.split(':');
      out.push({ dayOfWeek: Number(dowStr), hourOfDay: Number(hourStr), totalTokens });
    }
    return out;
  }

  async getActivityHeatmap(
    workspaceId?: string,
    metric: 'sessions' | 'messages' | 'edits' = 'messages',
    timezoneOffsetMinutes: number = 0,
    sinceMs?: number
  ): Promise<ActivityHeatmapData[]> {
    // Fetch raw timestamps and bucket them in JS. SQL-level
    // EXTRACT(... FROM ts + INTERVAL 'N minutes') has no portable form
    // (PG INTERVAL arithmetic vs SQLite strftime modifiers diverge once
    // you nest EXTRACT around the offset), so we compute the offset
    // bucket in JS where the math is identical on both backends.
    //
    // getTimezoneOffset() returns positive for west of UTC; we negate so
    // positive offsetMinutes = "shift forward to local."
    const offsetMs = -timezoneOffsetMinutes * 60_000;

    let timestamps: number[];

    const build = (conditions: string[], params: any[]) =>
      conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    if (metric === 'messages') {
      const conditions = [`direction = 'input'`];
      const params: any[] = [];
      if (workspaceId) {
        params.push(workspaceId);
        conditions.push(`session_id IN (SELECT id FROM ai_sessions WHERE workspace_id = $${params.length})`);
      }
      if (sinceMs) {
        params.push(sinceMs);
        conditions.push(`created_at >= to_timestamp($${params.length} / 1000.0)`);
      }
      const result = await this.db.query<{ created_at: unknown }>(
        `SELECT created_at FROM ai_agent_messages ${build(conditions, params)}`,
        params
      );
      timestamps = result.rows.map((row) => toEpochMs(row.created_at));
    } else if (metric === 'edits') {
      // `document_history.timestamp` is epoch milliseconds in an integer
      // column, not a timestamp -- it compares directly, with no to_timestamp.
      const conditions: string[] = [];
      const params: any[] = [];
      if (workspaceId) {
        params.push(workspaceId);
        conditions.push(`workspace_id = $${params.length}`);
      }
      if (sinceMs) {
        params.push(sinceMs);
        conditions.push(`timestamp >= $${params.length}`);
      }
      const result = await this.db.query<{ timestamp: number | string | bigint }>(
        `SELECT timestamp FROM document_history ${build(conditions, params)}`,
        params
      );
      timestamps = result.rows.map((row) => Number(row.timestamp));
    } else {
      const { clause, params } = this.sessionScope(workspaceId, sinceMs);
      const result = await this.db.query<{ created_at: unknown }>(
        `SELECT created_at FROM ai_sessions ${clause}`,
        params
      );
      timestamps = result.rows.map((row) => toEpochMs(row.created_at));
    }

    const buckets = new Map<string, number>();
    for (const ms of timestamps) {
      if (!Number.isFinite(ms)) continue;
      const shifted = new Date(ms + offsetMs);
      // Pull UTC fields off the shifted Date so we get the local hour/dow
      // without any further timezone conversion.
      const hour = shifted.getUTCHours();
      const dow = shifted.getUTCDay();
      const key = `${dow}:${hour}`;
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }

    const out: ActivityHeatmapData[] = [];
    for (const [key, count] of buckets) {
      const [dowStr, hourStr] = key.split(':');
      out.push({
        dayOfWeek: Number(dowStr),
        hourOfDay: Number(hourStr),
        activityCount: count,
      });
    }
    out.sort((a, b) =>
      a.dayOfWeek !== b.dayOfWeek
        ? a.dayOfWeek - b.dayOfWeek
        : a.hourOfDay - b.hourOfDay
    );
    return out;
  }

  /**
   * Get document edit statistics from document_history table
   */
  async getDocumentEditStats(workspaceId?: string): Promise<DocumentEditStats[]> {
    const whereClause = workspaceId ? `WHERE workspace_id = $1` : '';
    const params = workspaceId ? [workspaceId] : [];

    const result = await this.db.query(
      `SELECT
        workspace_id,
        file_path,
        COUNT(*) as edit_count,
        MAX(timestamp) as last_edited_at,
        MAX(size_bytes) as size_bytes
      FROM document_history
      ${whereClause}
      GROUP BY workspace_id, file_path
      ORDER BY edit_count DESC
      LIMIT 100`,
      params
    );

    return result.rows.map((row: any) => ({
      workspaceId: row.workspace_id,
      filePath: row.file_path,
      editCount: parseInt(row.edit_count) || 0,
      lastEdited: toEpochMs(row.last_edited_at) || Date.now(),
      sizeBytes: parseInt(row.size_bytes) || 0,
    }));
  }

  /**
   * Get document edit counts over time.
   *
   * `document_history.timestamp` is a BIGINT/INTEGER of epoch milliseconds on
   * both backends, so we filter and bucket entirely in JS rather than juggling
   * PG `DATE_TRUNC` / `to_timestamp` vs SQLite `strftime`.
   */
  async getDocumentEditTimeSeries(
    startDate: number,
    endDate: number,
    granularity: 'hour' | 'day' | 'week' | 'month' = 'day',
    workspaceId?: string
  ): Promise<{ timestamp: number; editCount: number }[]> {
    const whereClause = workspaceId
      ? `WHERE workspace_id = $3 AND timestamp >= $1 AND timestamp <= $2`
      : `WHERE timestamp >= $1 AND timestamp <= $2`;
    const params = workspaceId ? [startDate, endDate, workspaceId] : [startDate, endDate];
    const result = await this.db.query<{ timestamp: number | string | bigint }>(
      `SELECT timestamp FROM document_history ${whereClause}`,
      params,
    );
    return countsByTimeBucket(
      result.rows.map((row) => Number(row.timestamp)),
      granularity,
    ).map(({ timestamp, count }) => ({
      timestamp,
      editCount: count,
    }));
  }

  private async getTimeSeriesDataPortable(
    startDate: number,
    endDate: number,
    granularity: 'hour' | 'day' | 'week' | 'month',
    workspaceId?: string,
  ): Promise<TimeSeriesDataPoint[]> {
    const nonCodexWhereClause = workspaceId
      ? `WHERE provider <> 'openai-codex'
           AND workspace_id = $3
           AND created_at >= to_timestamp($1 / 1000.0)
           AND created_at <= to_timestamp($2 / 1000.0)`
      : `WHERE provider <> 'openai-codex'
           AND created_at >= to_timestamp($1 / 1000.0)
           AND created_at <= to_timestamp($2 / 1000.0)`;
    const nonCodexParams = workspaceId ? [startDate, endDate, workspaceId] : [startDate, endDate];
    const nonCodexRows = await this.db.query<{ id: string; created_at: unknown; metadata: unknown }>(
      `SELECT id, created_at, metadata
       FROM ai_sessions
       ${nonCodexWhereClause}`,
      nonCodexParams,
    );

    const buckets = new Map<number, {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      sessionIds: Set<string>;
    }>();

    for (const row of nonCodexRows.rows) {
      const tokenUsage = readTokenUsage(row.metadata);
      if (!tokenUsage) continue;
      const bucket = bucketStartMs(toEpochMs(row.created_at), granularity);
      if (!Number.isFinite(bucket)) continue;
      const agg = getOrCreateBucket(buckets, bucket);
      agg.inputTokens += tokenUsage.inputTokens;
      agg.outputTokens += tokenUsage.outputTokens;
      agg.totalTokens += tokenUsage.totalTokens;
      agg.sessionIds.add(row.id);
    }

    const codexSessionWhereClause = workspaceId
      ? `WHERE provider = 'openai-codex' AND workspace_id = $1`
      : `WHERE provider = 'openai-codex'`;
    const codexSessionParams = workspaceId ? [workspaceId] : [];
    const codexSessions = await this.db.query<{ id: string; provider_session_id: string | null }>(
      `SELECT id, provider_session_id
       FROM ai_sessions
       ${codexSessionWhereClause}`,
      codexSessionParams,
    );
    if (codexSessions.rows.length === 0) {
      return bucketsToTimeSeries(buckets);
    }

    const providerSessionIdBySession = new Map(
      codexSessions.rows.map((row) => [row.id, row.provider_session_id ?? row.id]),
    );
    const codexSessionIds = codexSessions.rows.map((row) => row.id);

    // Fetch only what the aggregation below actually consumes, filtered in SQL.
    // The previous version SELECTed `content` for *every* codex message and
    // filtered in JS, which materialized a multi-GB rowset (full assistant /
    // tool-output bodies) and crashed the worker while serializing it back to
    // main. Input rows need only `metadata.promptType` (no content); turn
    // tokens come solely from `turn.completed` output events, whose `content`
    // is a small usage summary. `metadata->>'eventType'` runs natively on
    // SQLite (>= 3.38) and as jsonb extraction on PGLite, so this is portable.
    const codexInputs = await this.db.query<{
      session_id: string;
      created_at: unknown;
      metadata: unknown;
    }>(
      `SELECT session_id, created_at, metadata
       FROM ai_agent_messages
       WHERE session_id = ANY($1::text[])
         AND direction = 'input'
         AND created_at <= to_timestamp($2 / 1000.0)
       ORDER BY session_id ASC, created_at ASC, id ASC`,
      [codexSessionIds, endDate],
    );

    const codexCompletedTurns = await this.db.query<{
      session_id: string;
      created_at: unknown;
      content: unknown;
    }>(
      `SELECT session_id, created_at, content
       FROM ai_agent_messages
       WHERE session_id = ANY($1::text[])
         AND direction = 'output'
         AND metadata->>'eventType' = 'turn.completed'
         AND created_at <= to_timestamp($2 / 1000.0)
       ORDER BY session_id ASC, created_at ASC, id ASC`,
      [codexSessionIds, endDate],
    );

    const turnsBySession = new Map<string, Array<{
      sessionId: string;
      providerSessionId: string;
      createdAtMs: number;
      inputTokens: number;
      outputTokens: number;
    }>>();

    const inputPromptTypeBySession = new Map<string, Array<{ createdAtMs: number; promptType: string | null }>>();

    for (const row of codexInputs.rows) {
      const createdAtMs = toEpochMs(row.created_at);
      if (!Number.isFinite(createdAtMs)) continue;
      const metadata = parseJsonRecord(row.metadata);
      const promptType = typeof metadata?.promptType === 'string' ? metadata.promptType : null;
      const items = inputPromptTypeBySession.get(row.session_id) ?? [];
      items.push({ createdAtMs, promptType });
      inputPromptTypeBySession.set(row.session_id, items);
    }

    for (const row of codexCompletedTurns.rows) {
      const createdAtMs = toEpochMs(row.created_at);
      if (!Number.isFinite(createdAtMs)) continue;
      const usage = readCodexUsage(row.content);
      if (!usage) continue;
      const providerSessionId = providerSessionIdBySession.get(row.session_id) ?? row.session_id;
      const items = turnsBySession.get(row.session_id) ?? [];
      items.push({
        sessionId: row.session_id,
        providerSessionId,
        createdAtMs,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      });
      turnsBySession.set(row.session_id, items);
    }

    const filteredTurnsBySession = new Map<string, Array<{
      sessionId: string;
      providerSessionId: string;
      createdAtMs: number;
      inputTokens: number;
      outputTokens: number;
    }>>();

    for (const [sessionId, turns] of turnsBySession) {
      const inputs = inputPromptTypeBySession.get(sessionId) ?? [];
      let inputIdx = 0;
      const filtered: typeof turns = [];
      for (const turn of turns) {
        while (inputIdx + 1 < inputs.length && inputs[inputIdx + 1].createdAtMs <= turn.createdAtMs) {
          inputIdx++;
        }
        const nearestPromptType = inputs[inputIdx]?.createdAtMs <= turn.createdAtMs
          ? inputs[inputIdx]?.promptType
          : null;
        if (nearestPromptType === 'system_reminder') continue;
        filtered.push(turn);
      }
      if (filtered.length > 0) {
        filteredTurnsBySession.set(sessionId, filtered);
      }
    }

    const providerTimeline = new Map<string, Array<{
      sessionId: string;
      createdAtMs: number;
      inputTokens: number;
      outputTokens: number;
    }>>();
    for (const turns of filteredTurnsBySession.values()) {
      for (const turn of turns) {
        const items = providerTimeline.get(turn.providerSessionId) ?? [];
        items.push(turn);
        providerTimeline.set(turn.providerSessionId, items);
      }
    }
    for (const items of providerTimeline.values()) {
      items.sort((a, b) => a.createdAtMs - b.createdAtMs);
    }

    const baselineBySession = new Map<string, { inputTokens: number; outputTokens: number }>();
    for (const items of providerTimeline.values()) {
      let prev: { sessionId: string; inputTokens: number; outputTokens: number } | null = null;
      for (const item of items) {
        if (!baselineBySession.has(item.sessionId)) {
          baselineBySession.set(item.sessionId, {
            inputTokens: prev?.inputTokens ?? 0,
            outputTokens: prev?.outputTokens ?? 0,
          });
        }
        prev = item;
      }
    }

    for (const [sessionId, turns] of filteredTurnsBySession) {
      let prevInput = baselineBySession.get(sessionId)?.inputTokens ?? 0;
      let prevOutput = baselineBySession.get(sessionId)?.outputTokens ?? 0;
      for (const turn of turns) {
        const deltaInput = Math.max(turn.inputTokens - prevInput, 0);
        const deltaOutput = Math.max(turn.outputTokens - prevOutput, 0);
        prevInput = turn.inputTokens;
        prevOutput = turn.outputTokens;
        if (turn.createdAtMs < startDate || turn.createdAtMs > endDate) continue;
        const bucket = bucketStartMs(turn.createdAtMs, granularity);
        if (!Number.isFinite(bucket)) continue;
        const agg = getOrCreateBucket(buckets, bucket);
        agg.inputTokens += deltaInput;
        agg.outputTokens += deltaOutput;
        agg.totalTokens += deltaInput + deltaOutput;
        agg.sessionIds.add(turn.sessionId);
      }
    }

    return bucketsToTimeSeries(buckets);
  }
}

/**
 * Coerce a TIMESTAMPTZ column value to epoch milliseconds.
 * PGLite returns Date instances; SQLite returns ISO strings.
 */
function toEpochMs(raw: unknown): number {
  if (raw == null) return NaN;
  if (raw instanceof Date) return raw.getTime();
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string') return new Date(raw).getTime();
  if (typeof raw === 'bigint') return Number(raw);
  return NaN;
}

function parseJsonRecord(raw: unknown): Record<string, any> | null {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed as Record<string, any> : null;
    } catch {
      return null;
    }
  }
  return raw && typeof raw === 'object' ? raw as Record<string, any> : null;
}

/** Defensively parse one `TokenUsageBucket` from already-parsed metadata JSON (old-shape sessions lack it entirely). */
function normalizeTokenUsageBucket(raw: unknown): TokenUsageBucketRow | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const bucket = raw as Record<string, unknown>;
  return {
    inputTokens: Number(bucket.inputTokens ?? 0) || 0,
    outputTokens: Number(bucket.outputTokens ?? 0) || 0,
    cacheReadInputTokens: Number(bucket.cacheReadInputTokens ?? 0) || 0,
    cacheCreationInputTokens: Number(bucket.cacheCreationInputTokens ?? 0) || 0,
    costUSD: Number(bucket.costUSD ?? 0) || 0,
  };
}

function normalizeTokenUsageByModel(raw: unknown): Record<string, TokenUsageBucketRow> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: Record<string, TokenUsageBucketRow> = {};
  for (const [modelName, value] of Object.entries(raw as Record<string, unknown>)) {
    const bucket = normalizeTokenUsageBucket(value);
    if (bucket) out[modelName] = bucket;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function readTokenUsage(rawMetadata: unknown): {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
} | null {
  const metadata = parseJsonRecord(rawMetadata);
  const tokenUsage = metadata?.tokenUsage;
  if (!tokenUsage || typeof tokenUsage !== 'object') return null;
  const inputTokens = Number((tokenUsage as Record<string, unknown>).inputTokens ?? 0);
  const outputTokens = Number((tokenUsage as Record<string, unknown>).outputTokens ?? 0);
  const totalTokens = Number(
    (tokenUsage as Record<string, unknown>).totalTokens
      ?? (Number.isFinite(inputTokens) ? inputTokens : 0) + (Number.isFinite(outputTokens) ? outputTokens : 0),
  );
  return {
    inputTokens: Number.isFinite(inputTokens) ? inputTokens : 0,
    outputTokens: Number.isFinite(outputTokens) ? outputTokens : 0,
    totalTokens: Number.isFinite(totalTokens) ? totalTokens : 0,
  };
}

/**
 * Per-turn token usage out of a stored raw provider frame, for either provider.
 *
 * claude-code keeps flat `input_tokens`/`output_tokens` on the `result` frame's
 * `usage`; codex nests the same idea but counts cached input separately, which
 * `readCodexUsage` already subtracts. A frame carrying neither returns null so
 * the caller can skip it rather than bank a zero.
 */
export function readTurnUsage(rawContent: unknown): {
  inputTokens: number;
  outputTokens: number;
} | null {
  const content = parseJsonRecord(rawContent);
  const usage = content?.usage;
  if (!usage || typeof usage !== 'object') return null;
  const fields = usage as Record<string, unknown>;

  // Codex reports cached input separately; its reader nets that off.
  if (fields.cached_input_tokens !== undefined) return readCodexUsage(rawContent);

  const inputTokens = Number(fields.input_tokens ?? 0);
  const outputTokens = Number(fields.output_tokens ?? 0);
  if (!Number.isFinite(inputTokens) && !Number.isFinite(outputTokens)) return null;
  return {
    inputTokens: Number.isFinite(inputTokens) ? inputTokens : 0,
    outputTokens: Number.isFinite(outputTokens) ? outputTokens : 0,
  };
}

function readCodexUsage(rawContent: unknown): {
  inputTokens: number;
  outputTokens: number;
} | null {
  const content = parseJsonRecord(rawContent);
  const usage = content?.usage;
  if (!usage || typeof usage !== 'object') return null;
  const inputTokens = Math.max(
    Number((usage as Record<string, unknown>).input_tokens ?? 0)
      - Number((usage as Record<string, unknown>).cached_input_tokens ?? 0),
    0,
  );
  const outputTokens = Number((usage as Record<string, unknown>).output_tokens ?? 0);
  return {
    inputTokens: Number.isFinite(inputTokens) ? inputTokens : 0,
    outputTokens: Number.isFinite(outputTokens) ? outputTokens : 0,
  };
}

function bucketStartMs(
  timestampMs: number,
  granularity: 'hour' | 'day' | 'week' | 'month',
): number {
  if (!Number.isFinite(timestampMs)) return NaN;
  const d = new Date(timestampMs);
  if (granularity === 'hour') {
    d.setUTCMinutes(0, 0, 0);
    return d.getTime();
  }
  if (granularity === 'day') {
    d.setUTCHours(0, 0, 0, 0);
    return d.getTime();
  }
  if (granularity === 'week') {
    d.setUTCHours(0, 0, 0, 0);
    const day = d.getUTCDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    d.setUTCDate(d.getUTCDate() + diffToMonday);
    return d.getTime();
  }
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

function countsByTimeBucket(
  timestamps: number[],
  granularity: 'hour' | 'day' | 'week' | 'month',
): Array<{ timestamp: number; count: number }> {
  const buckets = new Map<number, number>();
  for (const timestamp of timestamps) {
    const bucket = bucketStartMs(timestamp, granularity);
    if (!Number.isFinite(bucket)) continue;
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
  }
  return Array.from(buckets.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([timestamp, count]) => ({ timestamp, count }));
}

function getOrCreateBucket(
  buckets: Map<number, {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    sessionIds: Set<string>;
  }>,
  bucket: number,
): {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  sessionIds: Set<string>;
} {
  let agg = buckets.get(bucket);
  if (!agg) {
    agg = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      sessionIds: new Set<string>(),
    };
    buckets.set(bucket, agg);
  }
  return agg;
}

function bucketsToTimeSeries(
  buckets: Map<number, {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    sessionIds: Set<string>;
  }>,
): TimeSeriesDataPoint[] {
  return Array.from(buckets.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([timestamp, agg]) => ({
      timestamp,
      inputTokens: agg.inputTokens,
      outputTokens: agg.outputTokens,
      totalTokens: agg.totalTokens,
      sessionCount: agg.sessionIds.size,
    }));
}
