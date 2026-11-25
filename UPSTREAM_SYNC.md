Reviewed through: 044ff88a1

## 2026-11-25
Taken: 39645e64d fix: report archive state and comments from tracker_get (CLI gateway part only; the fork already had the tracker_get half, as upstream's own merge resolved it)
Taken: fa8c24063 Don't wake a lead that is waiting on the user's answer
Taken: e2c4730b2 fix: preserve empty workstream rows in the session tree
Taken: ca23b6e98 fix: show parent sessions with their own conversation in the chat picker
Taken: f5fc0724d fix: keep hidden HTML previews out of the main window
Taken: ba3b9f9c5 fix: keep the tracker quick-create title in view when many items are pending
Taken: 48c4d633b fix: tool-output retention stops at the first row still inside the window instead of skipping past it
Taken: 4885fadab feat: tool-output retention discards aged images and the duplicate result sidecar
Taken: fbb3710ad fix: SQLite backups keep rotating after the database is compacted to under half its size
Taken: 7fdd3b55e feat: workstreams group peer sessions under a folder row
Taken: 4880cef60 fix: an empty workstream shows as a selected workstream row
Taken: c2807a7cf feat: the open menu bar island can be resized by dragging its edges
Taken: ab6a54995 fix: toggling a model in provider settings no longer jumps the scroll position
Taken: c46d060fd fix: stop the agent transcript pulling the reader back while a reply streams
Taken: 144b7fd40 fix: keep the agent transcript on screen while main rebuilds an evicted session
Taken: dba4721d0 fix: keep the whole transcript when main rebuilds a session while others are busy
Taken: 4c602f8e5 fix: queued messages delivered in one turn now each open with the time they were queued and who sent them, replacing the explanatory header
Taken: 0212d1c0b fix: the Files-mode chat Context label clears when the file's tab closes
Taken: f7c9f824b feat: new worktrees default to the remote's default branch
Taken: 2f68a88cb feat: commit proposals accept folder paths
Taken: 345db12ad feat: switch branches from the Git panel
Taken: c4095db4b fix: folder commit proposals no longer pause auto-commit for already-committed edits by other sessions
Taken: 2ac90d09d Add Collapse all and Expand all buttons to the agent session list
Taken: e80a41f1e fix: keep Cancel aligned with newer session activity
Taken: 0fba6aa55 fix: restore Cancel when opening a running session
Taken: e9b29cd8e fix: keep same-named sender sessions distinguishable in queued message labels
Taken: 658410826 Move the Extension Dev indicator to the outer project rail and make the nav button menus use the shared floating menu positioning.
Taken: 61b7a4c8c fix: subfolder sessions naming their own checkout root keep commit auto-approval
Taken: 362ad52ca feat: list Codex models reported by the bundled codex binary
Taken: 1b73bbf45 fix: teamless projects no longer show unresolvable tracker publish notices
Taken: f3a865e31 fix: forked skills like /review can use Nimbalyst session-read tools
Taken: 5f0fbe0ae fix: SQLite cutover retries a briefly locked database folder before failing
Taken: e533d99ff feat: databases up to 3 GiB migrate to SQLite automatically
Taken: 0b9077b6c feat: prompt to migrate databases too large for automatic SQLite migration
Taken: f34659d36 feat: show Settings > Database to every install still on PGLite
Taken: 4fe4b970f feat: extensions can run commands in terminal tabs, gate on developer mode, and show status badge colors
Taken: 0306246f3 fix: auto-commit applies to other-worktree targets and files another session edited
Taken: 343f4afad feat: Run Manager (alpha) starts, stops and watches a project's dev servers in developer mode
Taken: 7caab1a45 chore: regenerate collab-bundle type declarations for gutter badge tones and the run log link
Taken: ae72d08f4 fix: Run Manager stops its processes on restart and update, and closes the stop and start races found in review
Taken: 7029f0a35 fix: Run Manager Stop cancels a start that is still checking its port, and leftovers are stopped when the shell exits before its pid is known
Taken: 7501992a7 fix: Terminal and Runs bottom panels use the same dash hide button as the Git panel
Taken: 39692ec5e chore: classify the migration consent prompt events as always ingested
Taken: a07922cb2 fix: stop personal sync AES from aborting the desktop app (#1979)
Taken: 9def5075c fix: reopen closed Local wiki, item and type tabs in Wiki mode
Taken: 03baebf98 fix: restart the SQLite worker after it exits instead of failing all DB calls
Taken: d53b46ff6 fix: import Windows sessions whose file ID is above 2^53
Taken: 0847da47a fix: list Claude Code Bash edits even when the command never names the file
Taken: 37ed70f61 deps: patch desktop and workspace dependencies
Taken: c4c427b7c fix: ship the patched image decoder for local memory models
Taken: 456f3842b fix: patch Hono advisories in MCP and sandbox dependencies (lockfile-only; carried by the regenerated lockfile)
Taken: ede6740af build: stop shipping the unused Sharp copy left over from the JavaScript Claude CLI
Taken: 42dcfbd83 deps: update claude-agent-sdk 0.3.321 -> 0.3.329 and codex-sdk 0.167.0 -> 0.171.0
Taken: 8b8253edd feat: default Codex sessions to GPT-6.2 Sol, matching codex 0.171.0
Taken: ef49e9599 feat: move the desktop app to Electron 45 and require macOS 13
Taken: 8d14d8e0c docs: list macOS 13 as the Mac requirement and point Monterey users to 0.84.2
Taken: 3d78d8744 fix: render editor screenshots in the app theme when the capture window is used without an explicit theme
Taken: add7e31a4 fix: a relaunch brings back the app window instead of focusing a hidden helper, and closing the Project Manager with no project open quits on Windows and Linux
Taken: c9adc9897 fix: a launch that loses the single-instance lock quits without booting the app
Taken: 9c403a8c5 fix: a SQLite worker recovery succeeds only if the worker that answered init is still alive
Taken: b619e8873 fix: a session delete now reaches the sync server even after a restart or while sync is down
Taken: 87eb44d91 fix: run automation sessions in the project that owns the automation file
Taken: 13eeb80c2 fix: schedule automations in every project open in a window's rail
Taken: 04f811af6 fix: tell the agent when the user approves a classifier-blocked call
Taken: 2e18fb6b6 fix: relay a macOS deep link from a launch that lost the lock to the running app
Taken: d9c0759e0 fix: keep queued session deletes per account, ahead of stale uploads, until sent
Taken: f1ad2f212 fix: type the pending-delete account scope with the branded personal member id
Taken: 70f057b56 fix: map tracker_get comments into the record's system block in nim
Taken: 86c6dff23 fix: hold background results for a waiting lead without losing or racing them
Taken: 7f7b6da28 fix: @-mention picker now lists all recent files, rail projects included
Taken: dea31a695 test: mock fuzzyMatch by deep path instead of the runtime barrel in WorkspaceHandlers tests
Taken: 1c02724a4 test: guard the #1606 diff skip with a pair budget instead of wall-clock time
Taken: 2327f9e2f fix: closing the Project Manager quits only when no other window is visible, and no longer reopens it on macOS
Taken: ed9cd9ae0 fix: keep touch readers put after native panning and drop stale transcript jumps on return
Taken: d3514807f fix: chat panel auto-select skips meta-agent parents like the session dropdown
Taken: 923776396 feat: filter the session list by phase, hiding complete by default
Taken: bc44036cc fix: session list phase filter shows every phase by default
Skipped: dc5a0ef93 Release v0.84.0 — release chore; the fork keeps its own version and CHANGELOG
Skipped: 30482d5b7 Release v0.84.1 — release chore; the fork keeps its own version and CHANGELOG
Skipped: 554658828 Release v0.84.2 — release chore; the fork keeps its own version and CHANGELOG
Skipped: 813acfb4c Release v0.84.3 — release chore; the fork keeps its own version and CHANGELOG
Skipped: 6ae9aadb3 Release v0.84.4 — release chore; the fork keeps its own version and CHANGELOG
Skipped: 044ff88a1 iOS Release v1.3.1 (build 5) — iOS release; the fork does not ship the iOS app
Skipped: 7ba1ed3a4 chore: add GPT-6.2 Sol and Astra to iOS model labels — iOS model labels only
Skipped: 7d4eef7cb chore: release @nimbalyst/extension-sdk 0.8.0 — release chore; the fork does not publish the SDK
Skipped: d015def24 chore: update bundled extension registry for Jupyter 0.4.2 and Electronics 0.2.2 — marketplace registry chore
Skipped: 3be9d6c50 chore: release Automations 1.0.4 — marketplace release chore
Skipped: 36f4520ed docs: rule against adding restrictions to existing behavior that nobody requested — docs for upstream's own agent rules
Skipped: 4bb36c3c7 docs: list session list Collapse all / Expand all in feature inventory — docs only
Skipped: 37247bc23 ci: fail the cross-arch mac build early when the target Sharp binding is missing — CI only
Skipped: b56119ffa ci: skip the onnxruntime-node CUDA download, whose 1.21.0 release asset now returns 404 — CI workflows only

## 2026-11-12
Taken: 3d0931249 fix: teamSignIn finishes the approved code when the wiki server restarts between calls
Skipped: f09de3566 chore: release @nimbalyst/cli and @nimbalyst/wiki-web 0.12.5 — release chore; the fork does not publish the CLI
Skipped: d221750cf chore: release @nimbalyst/cli and @nimbalyst/wiki-web 0.12.6 — release chore; the fork does not publish the CLI
Skipped: 43715b2a6 chore: release @nimbalyst/cli and @nimbalyst/wiki-web 0.12.7 — release chore; the fork does not publish the CLI

## Deferred
ab88a9f2e feat: commenter mode for team pages, and comment marks no longer break markdown — take only if the fork starts reviewing wikis with a team; 84 files, only CHANGELOG.md conflicts
c07a6a662 feat: publish a local wiki to a team project for review — needs ab88a9f2e
200ba856c fix: preserve wiki review anchors, access changes and embed diffs — needs ab88a9f2e and c07a6a662
4dce8378d chore: regenerate collab-bundle type declarations — regenerate after ab88a9f2e instead of picking
79e2130db chore: release Excalidraw 1.0.5 and MockupLM 1.0.5 to the marketplace — goes with ab88a9f2e
4c1e2521e fix: local wiki publish sends only stored page fields, treats type: page as plain, and leaves out oversized editor pages — needs c07a6a662
e3f7fa81d perf: republishing a local wiki sends only the pages that changed — needs c07a6a662
511f51369 fix: stop two timing races that failed CI unit tests — half of it patches the commenter mode from ab88a9f2e
c85f17daf fix: require extension calls to name the project they act on — breaks Git Insights until its backendClient passes workspacePath to callBackendTool
21e7baa68 fix: give editor file access the tab's own project — needs c85f17daf
