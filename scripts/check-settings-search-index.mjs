#!/usr/bin/env node
/**
 * Settings search anchors must exist (#1574).
 *
 * `settingsSearchIndex.ts` lists individual settings by the `data-testid` of
 * their row, and search scrolls to that row after opening the page. Renaming
 * or deleting a row without updating the list leaves an entry that opens the
 * page and silently goes nowhere. This fails the gate instead.
 *
 * Usage:
 *   node scripts/check-settings-search-index.mjs    # check, exit 1 on a missing anchor
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');

export const INDEX_FILE = 'packages/electron/src/renderer/components/Settings/settingsSearchIndex.ts';
export const RENDERER_DIR = 'packages/electron/src/renderer';

/** Every `anchor: '...'` in the index source. */
export function parseAnchors(src) {
  return [...src.matchAll(/\banchor:\s*'([^']+)'/g)].map((m) => m[1]);
}

/** String-literal test ids: `data-testid="x"`, `testId="x"`, and the `{'x'}` / `{"x"}` forms. */
export function parseTestIds(src) {
  const ids = new Set();
  for (const m of src.matchAll(/\b(?:data-testid|testId)=(?:"([^"]+)"|\{\s*['"]([^'"]+)['"]\s*\})/g)) {
    ids.add(m[1] ?? m[2]);
  }
  return ids;
}

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__tests__') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (extname(full) === '.tsx') out.push(full);
  }
  return out;
}

export function collectRendererTestIds(root = repoRoot) {
  const ids = new Set();
  for (const file of walk(join(root, RENDERER_DIR), [])) {
    for (const id of parseTestIds(readFileSync(file, 'utf8'))) ids.add(id);
  }
  return ids;
}

export function findMissingAnchors(anchors, testIds) {
  return anchors.filter((anchor) => !testIds.has(anchor));
}

export function checkSettingsSearchIndex(root = repoRoot) {
  const anchors = parseAnchors(readFileSync(join(root, INDEX_FILE), 'utf8'));
  return findMissingAnchors(anchors, collectRendererTestIds(root));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const missing = checkSettingsSearchIndex();
  if (missing.length > 0) {
    console.error('Settings search entries point at rows that no longer exist:');
    for (const anchor of missing) console.error(`  ${anchor}`);
    console.error(`Update ${INDEX_FILE}, or restore the row's data-testid.`);
    process.exit(1);
  }
  console.log('Settings search anchors: OK');
}
