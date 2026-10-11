// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { findProjectIcon } from '../projectIcon';

describe('findProjectIcon', () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('prefers .nimbalyst/icon over favicons, skips empty files, and returns null when nothing matches', async () => {
    dir = mkdtempSync(join(tmpdir(), 'project-icon-'));
    expect(await findProjectIcon(dir)).toBeNull();

    writeFileSync(join(dir, 'favicon.svg'), '');
    mkdirSync(join(dir, 'public'));
    writeFileSync(join(dir, 'public', 'favicon.png'), 'png');
    expect(await findProjectIcon(dir)).toBe(`data:image/png;base64,${Buffer.from('png').toString('base64')}`);

    mkdirSync(join(dir, '.nimbalyst'));
    writeFileSync(join(dir, '.nimbalyst', 'icon.svg'), '<svg/>');
    expect(await findProjectIcon(dir)).toMatch(/^data:image\/svg\+xml;base64,/);
  });
});
