-- Estimated tokens per tool, for the AI Usage Report Tools tab. Providers bill
-- per request, never per tool, so these are sizes: what the model wrote to call
-- the tool (call_tokens) and what the result put into the conversation
-- (result_tokens), at ~4 characters per token. Additive only.

ALTER TABLE tool_usage_counters ADD COLUMN call_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tool_usage_counters ADD COLUMN result_tokens INTEGER NOT NULL DEFAULT 0;

-- Rows recorded before this migration carry counts but no sizes. The size
-- backfill fills them from stored messages created before this cutoff, which
-- never overlaps the sizes the live write path records from now on.
ALTER TABLE tool_usage_backfill_meta ADD COLUMN size_cutoff_at TIMESTAMPTZ;
UPDATE tool_usage_backfill_meta
SET size_cutoff_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE size_cutoff_at IS NULL;

-- Separate from tool_usage_backfill_sessions: a session whose counts were
-- already backfilled still needs its sizes, and the reverse.
CREATE TABLE IF NOT EXISTS tool_usage_size_backfill_sessions (
  session_id TEXT PRIMARY KEY,
  backfilled_at TIMESTAMPTZ NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
