// @vitest-environment node
import { it, expect, vi } from 'vitest';
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

it.each(['alone', 'external session', 'overlapping shell'])('ignores cold-cache identical rebuilds with %s while retaining real change evidence', async mode => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'nim-rebuild-regression-'));
  const root = await fs.realpath(temp);
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  const links: ShellFileEvidence[] = [];
  let emit!: (file: string) => void;
  let now = Date.now();
  const report = vi.fn();
  const service = new ShellFileAttribution({
    subscribe: async (_root, changed) => { emit = changed; return () => {}; },
    prepareCheckout: prepareShellCheckoutBaseline,
    read: async file => {
      try { return { fingerprint: contentFingerprint(await fs.readFile(file)), modifiedAt: now }; }
      catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
    },
    knownWrite: () => false, otherSessions: () => mode === 'external session' ? ['external'] : [],
    report,
    persist: async e => { links.push(e); return 'persisted'; },
    now: () => now, settleMs: 0,
  });
  let generation: string | undefined;
  let other: string | undefined;
  try {
    git('init', '-q'); git('config', 'user.email', 'fixture@example.invalid'); git('config', 'user.name', 'Fixture');
    expect(await fs.realpath(git('rev-parse', '--show-toplevel').trim())).toBe(root);
    for (const file of ['generated.d.ts', 'dirty.ts', 'revert.ts', 'committed.ts', 'deleted.ts']) await fs.writeFile(path.join(root, file), 'baseline\n');
    git('add', '.'); git('commit', '-qm', 'baseline');
    await fs.writeFile(path.join(root, 'dirty.ts'), 'existing dirty content\n');
    await fs.writeFile(path.join(root, 'revert.ts'), 'existing dirty content\n');
    // An unrelated oversized untracked artifact must not disable the baseline.
    const large = await fs.open(path.join(root, 'large-artifact.bin'), 'w');
    await large.truncate(65 * 1024 * 1024); await large.close();
    generation = await service.register('writer', root);
    await service.pre(generation, 'rebuild', 'Bash');
    if (mode === 'overlapping shell') {
      other = await service.register('other', root);
      await service.pre(other, 'other-command', 'Bash');
    }
    now++;
    await fs.unlink(path.join(root, 'generated.d.ts')); emit(path.join(root, 'generated.d.ts'));
    await service.flush();
    for (const [file, text] of [['generated.d.ts', 'baseline\n'], ['dirty.ts', 'existing dirty content\n']]) {
      await fs.writeFile(path.join(root, file), text); emit(path.join(root, file));
    }
    await service.completed(generation, 'rebuild');
    if (other) await service.completed(other, 'other-command');
    expect(links).toEqual([]);
    // A concurrent agent session is noted, never a fault; nothing else may report.
    const reasons = () => new Set(report.mock.calls.map(([, reason]) => reason));
    expect([...reasons()]).toEqual(mode === 'external session' ? ['uninstrumented'] : []);
    await service.pre(generation, 'authored', 'Bash');
    if (other) await service.pre(other, 'other-authored', 'Bash');
    now++;
    for (const [file, text] of [['dirty.ts', 'authored\n'], ['revert.ts', 'baseline\n'], ['committed.ts', 'committed edit\n']]) {
      await fs.writeFile(path.join(root, file), text); emit(path.join(root, file));
    }
    await fs.unlink(path.join(root, 'deleted.ts')); emit(path.join(root, 'deleted.ts'));
    if (other) {
      await service.completed(other, 'other-authored');
      now++;
      await fs.writeFile(path.join(root, 'dirty.ts'), 'later write after the competing tool exits\n');
      emit(path.join(root, 'dirty.ts'));
    }
    git('add', '-u'); git('commit', '-qm', 'authored');
    await service.completed(generation, 'authored');
    if (mode === 'overlapping shell') {
      expect(links).toEqual([]);
      expect(reasons()).toContain('competingOwners');
    } else {
      // Another agent's turn in the workspace shares the link instead of withholding it.
      expect(links.map(e => path.basename(e.filePath)).sort()).toEqual(['committed.ts', 'deleted.ts', 'dirty.ts', 'revert.ts']);
      expect([...reasons()]).toEqual(mode === 'external session' ? ['uninstrumented'] : []);
    }
  } finally {
    if (generation) await service.release(generation);
    if (other) await service.release(other);
    await fs.rm(root, { recursive: true, force: true });
  }
});
