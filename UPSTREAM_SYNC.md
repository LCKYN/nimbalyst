Reviewed through: 43715b2a6

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
