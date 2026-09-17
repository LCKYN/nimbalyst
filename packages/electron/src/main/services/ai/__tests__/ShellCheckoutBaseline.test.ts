// @vitest-environment node
import { it, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ShellFileAttribution, type ShellFileEvidence } from '../ShellFileAttribution';
import { prepareShellCheckoutBaseline } from '../ShellCheckoutBaseline';
import { contentFingerprint } from '../../../file/knownFileWrites';

it('excludes checkout copies but retains edits committed by the creating tool and subsequent shell edits', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'nim-checkout-regression-'));
  const root = await fs.realpath(temp), nested = path.join(root, 'scratch', 'checkout');
  const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
  const links: ShellFileEvidence[] = [];
  let emit!: (file: string) => void;
  let now = Date.now();
  const service = new ShellFileAttribution({
    subscribe: async (_root: string, changed: (file: string) => void) => { emit = changed; return () => {}; },
    prepareCheckout: prepareShellCheckoutBaseline,
    read: async (file: string) => {
      try { return { fingerprint: contentFingerprint(await fs.readFile(file)), modifiedAt: now }; }
      catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
    },
    knownWrite: () => false,
    otherSessions: () => [],
    persist: async (e: ShellFileEvidence) => { links.push(e); return 'persisted' as const; },
    now: () => now,
    settleMs: 0,
  });
  let generation: string | undefined;
  try {
    git(root, 'init', '-q');
    git(root, 'config', 'user.email', 'fixture@example.invalid');
    git(root, 'config', 'user.name', 'Fixture');
    expect(await fs.realpath(git(root, 'rev-parse', '--show-toplevel').trim())).toBe(root);
    await fs.mkdir(path.join(root, '.claude'));
    await fs.writeFile(path.join(root, '.claude', 'unchanged.md'), 'checkout\n');
    await fs.writeFile(path.join(root, 'edited.md'), 'baseline\n');
    await fs.writeFile(path.join(root, 'deleted.md'), 'baseline\n');
    git(root, 'add', '.'); git(root, 'commit', '-qm', 'baseline');
    generation = await service.register('writer', root);
    await service.pre(generation, 'create-and-edit', 'Bash');
    git(root, 'worktree', 'add', '-q', '-b', 'fixture', nested);
    expect(await fs.realpath(git(nested, 'rev-parse', '--show-toplevel').trim())).toBe(nested);
    // The filesystem can deliver after the command has already committed.
    await fs.writeFile(path.join(nested, 'edited.md'), 'authored\n');
    await fs.unlink(path.join(nested, 'deleted.md'));
    git(nested, 'add', '-u'); git(nested, 'commit', '-qm', 'authored');
    now++;
    emit(path.join(nested, '.claude', 'unchanged.md'));
    emit(path.join(nested, 'edited.md'));
    emit(path.join(nested, 'deleted.md'));
    await service.flush();
    expect(links).toEqual([]); // New-root candidates must wait for checkout reconciliation.
    await service.completed(generation, 'create-and-edit');
    expect(links.map(e => path.relative(nested, e.filePath))).toEqual(['edited.md', 'deleted.md']);
    await service.pre(generation, 'later-edit', 'Bash');
    now++;
    await fs.writeFile(path.join(nested, '.claude', 'unchanged.md'), 'real later edit\n');
    emit(path.join(nested, '.claude', 'unchanged.md'));
    await service.completed(generation, 'later-edit');
    expect(links.map(e => e.toolUseId)).toEqual(['create-and-edit', 'create-and-edit', 'later-edit']);
  } finally {
    if (generation) await service.release(generation);
    await fs.rm(root, { recursive: true, force: true });
  }
});
