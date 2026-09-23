import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  checkSettingsSearchIndex,
  findMissingAnchors,
  parseAnchors,
  parseTestIds,
} from '../check-settings-search-index.mjs';

test('every settings search anchor exists as a row test id in the renderer', () => {
  assert.deepEqual(checkSettingsSearchIndex(), []);
});

test('reads anchors from the index and test ids in every literal form', () => {
  assert.deepEqual(parseAnchors(`{ anchor: 'row-a', name: 'A' },\n{ anchor:'row-b' }`), ['row-a', 'row-b']);
  const ids = parseTestIds(`<div data-testid="x" /><T testId="y" /><div data-testid={'z'} /><T testId={dynamic} />`);
  assert.deepEqual([...ids].sort(), ['x', 'y', 'z']);
});

test('reports an anchor whose row is gone', () => {
  assert.deepEqual(findMissingAnchors(['kept', 'removed'], new Set(['kept'])), ['removed']);
});
