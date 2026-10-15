#!/usr/bin/env node
/**
 * Fails if an IPC channel that an out-of-tree extension depends on stops being
 * registered (or, for events, emitted) in packages/electron/src/main.
 *
 * The channels come from two extensions that live in separate repos and call
 * `window.electronAPI.invoke(...)` / `.on(...)` directly, so nothing in this
 * repo's typecheck or tests notices when a handler is removed:
 *   - AI Usage (com.nimbalyst.ai-usage):      github.com/LCKYN/nimbalyst-ai-usage
 *   - Git Insights:                           github.com/LCKYN/nimbalyst-git-insights
 * When either extension starts calling a new channel, add it here.
 *
 * ponytail: checks that each channel exists, not the shape of its arguments or
 * response; a contract test against the extensions' types is the upgrade path
 * if a signature change ever breaks one silently.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAIN_ROOT = path.join(repoRoot, 'packages/electron/src/main');

/** Request/response channels the extensions `invoke`. */
const HANDLED = [
  // AI Usage
  'usage-analytics:get-overview',
  'usage-analytics:get-activity-heatmap',
  'usage-analytics:get-token-heatmap',
  'usage-analytics:get-session-breakdown',
  'usage-analytics:get-session-turns',
  'usage-analytics:get-usage-by-project',
  'tool-usage:get-report',
  'tool-usage:backfill',
  'claude-usage:get',
  'usage-report:open-session',
  // Git Insights
  'sessions:list',
  'session-files:get-by-sessions',
  'session-files:get-sessions-by-file',
];

/** Events the extensions subscribe to with `electronAPI.on` / `host.onWorkspaceEvent`. */
const EMITTED = [
  // AI Usage
  'claude-usage:update',
  // Git Insights
  'session-files:updated',
  'git:status-changed',
];

function listSourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== '__tests__') out.push(...listSourceFiles(full));
    } else if (/\.[cm]?[jt]sx?$/.test(entry) && !/\.(test|spec)\./.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const handlerPattern = (ch) =>
  new RegExp(`\\b(?:safeHandle|safeOn|ipcMain\\.handle|ipcMain\\.on)\\(\\s*['"\`]${escape(ch)}['"\`]`);
// `webContents.send('x', ...)`, `safeSend(event, 'x', ...)`, `emitToAllWindows('x', ...)`.
const emitPattern = (ch) =>
  new RegExp(`\\b(?:send|safeSend|emitToAllWindows)\\(\\s*(?:[\\w.]+\\s*,\\s*)?['"\`]${escape(ch)}['"\`]`);

const sources = listSourceFiles(MAIN_ROOT).map((file) => readFileSync(file, 'utf8'));
const missing = [
  ...HANDLED.filter((ch) => !sources.some((src) => handlerPattern(ch).test(src))).map((ch) => `${ch} (handler)`),
  ...EMITTED.filter((ch) => !sources.some((src) => emitPattern(ch).test(src))).map((ch) => `${ch} (event)`),
];

if (missing.length) {
  console.error('[check-extension-ipc-channels] Extensions depend on IPC channels that are no longer registered in packages/electron/src/main:');
  for (const m of missing) console.error(`  - ${m}`);
  console.error('Restore the handler/emitter, or update the extension first and then this list.');
  process.exit(1);
}
console.log(`[check-extension-ipc-channels] ${HANDLED.length + EMITTED.length} extension IPC channels registered.`);
