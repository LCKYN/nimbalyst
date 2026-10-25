-- Prompt timestamps per session, for the AI Usage extension's report.
--
-- `getUsageOverview` (via loadPromptTimes) and the activity heatmap both read
--   SELECT session_id, created_at FROM ai_agent_messages WHERE direction = 'input'
-- No index leads with `direction`, so each read scanned the table's whole main
-- b-tree (~500 MB on a 290k-message install) to find ~3k prompts: 3.5 s on a
-- cold cache, holding the report's Overview on "Loading...".
--
-- Partial, so only prompts are indexed (~200 KB), and covering, so the query
-- never touches the table. The queries must keep the literal 'input' for the
-- planner to match the WHERE clause.

CREATE INDEX IF NOT EXISTS idx_ai_agent_messages_input_times
  ON ai_agent_messages(session_id, created_at)
  WHERE direction = 'input';
