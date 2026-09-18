import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { launchElectronApp, waitForAppReady } from '../helpers';
import { dismissAPIKeyDialog } from '../utils/testHelpers';
test.skip(() => !process.env.RUN_REAL_CODEX, 'Requires Codex CLI auth + RUN_REAL_CODEX=1');
test.setTimeout(240_000);
test('production Codex shell hooks persist sequential owners after a failed MCP lookup', async ({}, testInfo) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nim-shell-implementation-')),
    workspace = path.join(root, 'workspace'),
    database = path.join(root, 'database'),
    userData = path.join(root, 'user-data'),
    codexHome = path.join(root, 'codex-home');
  for (const dir of [workspace, database, userData, codexHome]) await fs.mkdir(dir, { mode: 0o700 });
  await fs.copyFile(
    path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'auth.json'),
    path.join(codexHome, 'auth.json')
  );
  await fs.chmod(path.join(codexHome, 'auth.json'), 0o600);
  await fs.writeFile(path.join(workspace, 'shared.ts'), '// baseline\n');
  await fs.writeFile(path.join(workspace, 'readonly.ts'), '// unchanged\n');
  await fs.writeFile(path.join(workspace, 'after-failure.ts'), '// baseline\n');
  const git = (...args: string[]) => execFileSync('git', ['-C', workspace, ...args], { encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.name', 'Tracking Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  expect(await fs.realpath(git('rev-parse', '--show-toplevel').trim())).toBe(await fs.realpath(workspace));
  await fs.mkdir(path.join(workspace, '.claude'));
  for (let i = 0; i < 7500; i += 64) await Promise.all(Array.from({ length: Math.min(64, 7500 - i) }, (_, j) =>
    fs.writeFile(path.join(workspace, '.claude', `command-${i + j}.md`), 'checkout baseline\n')));
  await fs.writeFile(path.join(workspace, 'rebuild.cjs'), `const fs = require('fs'); fs.rmSync('types', {recursive: true, force: true}); fs.mkdirSync('types'); for (let i=0;i<300;i++) fs.writeFileSync('types/generated-'+i+'.d.ts', 'export declare const value: string;\\n');`);
  execFileSync(process.execPath, ['rebuild.cjs'], { cwd: workspace });
  git('add', '.');
  git('commit', '-qm', 'Fixture baseline');
  let app: Awaited<ReturnType<typeof launchElectronApp>> | undefined;
  const evidence: any = { root, owners: [] };
  try {
    const launchOptions = {
      mainPath: process.env.NIMBALYST_E2E_MAIN_PATH,
      workspace,
      preserveTestDatabase: true,
      // This disposable fixture creates Git worktrees; workspace-write protects .git.
      permissionMode: 'none' as const,
      recordVideo: { dir: path.join(testInfo.outputDir, 'video') },
      env: {
        NIMBALYST_PERMISSION_MODE: 'bypass-all',
        NIMBALYST_USER_DATA_PATH: database,
        NIMBALYST_USER_DATA_DIR: userData,
        NIMBALYST_CDP_PORT: '0',
        CODEX_HOME: codexHome,
      },
    };
    app = await launchElectronApp(launchOptions);
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await waitForAppReady(page);
    await dismissAPIKeyDialog(page);
    evidence.isolation = await app.evaluate(({ app }) => ({
      userData: app.getPath('userData'),
      database: process.env.NIMBALYST_USER_DATA_PATH,
    }));
    expect(evidence.isolation).toEqual({ userData, database });
    await page.evaluate(async () => {
      await (window as any).electronAPI.invoke('ai:saveSettings', {
        providerSettings: { 'openai-codex': { enabled: true } },
      });
      (window as any).__fileLinkEvents = [];
      (window as any).electronAPI.on('session-files:updated', (...args: any[]) =>
        (window as any).__fileLinkEvents.push(args)
      );
    });
    await expect.poll(async () => page.evaluate(async () =>
      (await (window as any).electronAPI.invoke('openai-codex:check-login')).isLoggedIn
    ), { timeout: 15_000, message: 'Isolated Codex auth must be ready before exercising tracking' }).toBe(true);
    for (const marker of ['first', 'second']) {
      const session = await page.evaluate(
        async ({ workspace }) =>
          (window as any).electronAPI.invoke(
            'ai:createSession',
            'openai-codex',
            undefined,
            workspace,
            'openai-codex:gpt-6-astra',
            'agent'
          ),
        { workspace }
      );
      expect(session.id).toBeTruthy();
      evidence.owners.push(session.id);
      const checkoutStep = marker === 'first' ? 'First run `node rebuild.cjs` to delete and regenerate identical tracked declarations. Then create the fixture worktree by running `git worktree add --detach scratch-checkout HEAD`. If this fails, stop and report its full error. Then run `printf \'// authored\\n\' > scratch-checkout/shared.ts`. This checkout is a required part of the test. ' : '';
      const result = await page.evaluate(
        async ({ workspace, id, marker, checkoutStep }) =>
          (window as any).electronAPI.invoke(
            'ai:sendMessage',
            `This is an isolated file tracking acceptance fixture. ${checkoutStep}In strict sequence in this single turn: 1. Use your normal shell tool to execute exactly: printf '// ${marker}\\n' > shared.ts; cat readonly.ts; 2. Call the nimbalyst-trackers tracker_get MCP tool with id "shell-attribution-fixture-missing-item" exactly once. The item does not exist; its error is expected. 3. Continue despite that error and execute: printf '// ${marker}\\n' > after-failure.ts; Do not apply a patch, inspect other files, commit, retry the lookup, or change anything else. End with DONE.`,
            undefined,
            id,
            workspace
          ),
        { workspace, id: session.id, marker, checkoutStep }
      );
      evidence[marker] = result;
      evidence[marker + 'Raw'] = await page.evaluate(async id =>
        (window as any).electronAPI.invoke('test:query-db', 'SELECT content FROM ai_agent_messages WHERE session_id=$1 AND direction=$2 ORDER BY id', [id, 'output']), session.id);
      expect(result.content, 'Codex must finish the fixture commands before file assertions').toContain('DONE');
      if (marker === 'first') expect(await fs.readFile(path.join(workspace, 'scratch-checkout', 'shared.ts'), 'utf8')).toBe('// authored\n');
      await expect
        .poll(() => fs.readFile(path.join(workspace, 'shared.ts'), 'utf8'), { timeout: 60_000 })
        .toBe(`// ${marker}\n`);
      const links = await page.evaluate(
        async ({ workspace, filePath }) =>
          (window as any).electronAPI.invoke('sessions:get-by-file', workspace, filePath),
        { workspace, filePath: path.join(workspace, 'shared.ts') }
      );
      evidence[marker + 'Links'] = links;
      expect(links.map((x: any) => x.id).sort()).toEqual([...evidence.owners].sort());
      expect(links.every((x: any) => x.fileAttribution === 'inferred' && x.lastFileEditAt > 0)).toBe(true);
      expect(await fs.readFile(path.join(workspace, 'after-failure.ts'), 'utf8')).toBe(`// ${marker}\n`);
      const afterFailure = await page.evaluate(
        async ({ workspace, id, filePath }) => {
          const result = await (window as any).electronAPI.invoke(
            'test:query-db', 'SELECT content FROM ai_agent_messages WHERE session_id = $1 AND direction = $2', [id, 'output']
          );
          const failedLookup = result.rows.some((row: any) => {
            try {
              const item = JSON.parse(row.content)?.params?.item;
              return item?.type === 'mcpToolCall' && item.tool === 'tracker_get' && item.status === 'failed';
            } catch { return false; }
          });
          const links = await (window as any).electronAPI.invoke('sessions:get-by-file', workspace, filePath);
          return { failedLookup, owners: links.map((x: any) => x.id).sort() };
        },
        { workspace, id: session.id, filePath: path.join(workspace, 'after-failure.ts') }
      );
      const commitContext = await page.evaluate(async ({ workspace, id }) =>
        (window as any).electronAPI.invoke('git:get-commit-context', workspace, id), { workspace, id: session.id });
      evidence[marker + 'Coverage'] = commitContext.coverage;
      expect(commitContext.coverage).toEqual([expect.objectContaining({ sessionId: session.id, state: 'no-detected-fault' })]);
      const durableCoverage = await page.evaluate(async id =>
        (window as any).electronAPI.invoke('test:query-db', 'SELECT data FROM shell_tracking_coverage WHERE session_id = $1', [id]), session.id);
      expect(JSON.parse(durableCoverage.rows[0].data).active).toEqual([]);
      expect(JSON.parse(durableCoverage.rows[0].data).pendingTools).toEqual({});
      evidence[marker + 'AfterFailure'] = afterFailure;
      expect(afterFailure).toEqual({ failedLookup: true, owners: [...evidence.owners].sort() });
    }
    expect(await fs.readFile(path.join(workspace, 'scratch-checkout', 'shared.ts'), 'utf8')).toBe('// authored\n');
    const checkoutLinks = await page.evaluate(async ({ workspace }) => {
      const api = (window as any).electronAPI;
      return {
        copied: await api.invoke('sessions:get-by-file', workspace, workspace + '/scratch-checkout/.claude/command-0.md'),
        edited: await api.invoke('sessions:get-by-file', workspace, workspace + '/scratch-checkout/shared.ts'),
      };
    }, { workspace });
    expect(checkoutLinks.copied).toEqual([]);
    expect(checkoutLinks.edited.map((s: any) => s.id)).toEqual([evidence.owners[0]]);
    evidence.checkoutLinks = checkoutLinks;
    const readLinks = await page.evaluate(
      async ({ workspace, filePath }) =>
        (window as any).electronAPI.invoke('sessions:get-by-file', workspace, filePath),
      { workspace, filePath: path.join(workspace, 'readonly.ts') }
    );
    expect(readLinks).toEqual([]);
    evidence.rows = await page.evaluate(
      async ({ workspace }) =>
        (window as any).electronAPI.invoke(
          'test:query-db',
          'SELECT session_id, file_path, link_type, metadata FROM session_files WHERE workspace_id = $1',
          [workspace]
        ),
      { workspace }
    );
    expect(evidence.rows.rows.filter((row: any) => row.file_path.includes('/scratch-checkout/.claude/'))).toEqual([]);
    expect(evidence.rows.rows.filter((row: any) => row.file_path.includes('/types/generated-'))).toEqual([]);
    expect(git('diff', '--name-only', 'HEAD', '--', 'types')).toBe('');
    evidence.notifications = await page.evaluate(() => (window as any).__fileLinkEvents);
    expect(evidence.notifications.length).toBeGreaterThan(0);
    // A waiting, acknowledged MCP call keeps the turn active without an unfinished shell write.
    const waitingId = await page.evaluate(async ({ workspace }) => {
      const api = (window as any).electronAPI;
      const session = await api.invoke('ai:createSession', 'openai-codex', undefined, workspace, 'openai-codex:gpt-6-astra', 'agent');
      void api.invoke('ai:sendMessage', 'Use the nimbalyst AskUserQuestion MCP tool to ask "Proceed with the fixture?" with Yes and No options. Wait for the answer. Do not run any shell commands or other tools.', undefined, session.id, workspace).catch(() => {});
      return session.id;
    }, { workspace });
    await expect.poll(async () => page.evaluate(async id => {
      const result = await (window as any).electronAPI.invoke('test:query-db', 'SELECT content FROM ai_agent_messages WHERE session_id = $1 AND direction = $2', [id, 'output']);
      return result.rows.some((row: any) => { try { const value = JSON.parse(row.content); return value.method === 'item/started' && value.params?.item?.tool === 'AskUserQuestion'; } catch { return false; } });
    }, waitingId), { timeout: 60_000 }).toBe(true);
    await expect.poll(async () => page.evaluate(async id => {
      const result = await (window as any).electronAPI.invoke('test:query-db', 'SELECT data FROM shell_tracking_coverage WHERE session_id = $1', [id]);
      return result.rows[0] ? JSON.parse(result.rows[0].data).pendingTools : null;
    }, waitingId)).toEqual({});
    evidence.waitingSession = waitingId;
    await app.close();
    app = await launchElectronApp(launchOptions);
    const restartedPage = await app.firstWindow();
    await restartedPage.waitForLoadState('domcontentloaded');
    await waitForAppReady(restartedPage);
    const restored = await restartedPage.evaluate(async id => (window as any).electronAPI.invoke('session-files:coverage', [id]), waitingId);
    evidence.afterRestart = restored;
    expect(restored).toEqual([expect.objectContaining({ sessionId: waitingId, state: 'no-detected-fault', reasons: {} })]);

  } finally {
    await app?.close();
    await fs.rm(codexHome, { recursive: true, force: true });
    await fs.writeFile(testInfo.outputPath('app-evidence.json'), JSON.stringify(evidence, null, 2));
    await testInfo.attach('evidence', {
      body: JSON.stringify(evidence, null, 2),
      contentType: 'application/json',
    });
  }
});
