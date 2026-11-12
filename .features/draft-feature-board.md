---
id: draft-feature-board
title: See what each feature is waiting on, on one board
kind: feature
relates: []
branch: feat/feature-board
mrs: []
source: new
---
## Goal
One place that answers "what does this feature need from me right now", so I don't have to open each session to find out. A feature groups its tasks and AI sessions; anything waiting on a person shows up on the feature itself.

## Acceptance criteria
- [ ] A full-window "Features" panel lists every file in `.features/` as a card, in six status columns (จะทำ, ปรึกษา, เริ่มทำ, กำลังทำ, รอตัดสินใจ, เสร็จแล้ว); cancelled features are hidden.
- [ ] A card's status is computed from tasks, sessions, the worktree and the MR by the table in `~/.claude/feature-rules.md`, never read from the file; the same inputs always give the same status (unit test).
- [ ] Opening a card shows, in this order: header (tasks done x/y, tokens and cost, MR state), Waiting on you, Stuck, Still missing, then tasks with their sessions.
- [ ] "Waiting on you" lists every session of the feature with an unanswered prompt without the AI having to report it; clicking one opens that session.
- [ ] Tokens and cost on a card equal the sum over the sessions linked to its `feature-task` items.
- [ ] No tracker, database-schema or provider code in the fork changes; the only core file touched is `scripts/check-extension-ipc-channels.mjs`.

## Related code
- The extension lives outside this repo at `~/Documents/repo/nimbalyst-feature-board/` (same setup as `nimbalyst-ai-usage`).
- `scripts/check-extension-ipc-channels.mjs`: the list of core IPC channels extensions rely on.
- Reads through `sessions:list`, `document-service:tracker-items-list` and `usage-analytics:get-session-breakdown`.

## Decisions
- 2026-11-12: Tasks are tracker items of the personal type `feature-task`, not a new table and not the built-in `task` type (that one is a team type and its items queue for sync).
- 2026-11-12: Sessions are attributed to tasks through the existing session-to-tracker link; no `FEATURE_ID`/`TASK_ID` environment variables and no session hooks.
- 2026-11-12: Wait items are computed from session and MR state, not stored, so a session that forgets to report still shows up.
- 2026-11-12: No new MCP tools in the first version; the existing tracker tools and AskUserQuestion cover them.
