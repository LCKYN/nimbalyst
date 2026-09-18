// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import path from 'node:path';

const fixture = vi.hoisted(() => ({ observed: undefined as undefined | ((event: string, file: string, at: number) => void) }));
vi.mock('electron', () => ({ app: { isPackaged: false } }));
vi.mock('@nimbalyst/runtime/storage/repositories/SessionFilesRepository', () => ({ SessionFilesRepository: { addFileLink: vi.fn() } }));
vi.mock('@nimbalyst/runtime/ai/server', () => ({ OpenAICodexProvider: { setShellTrackingHost: vi.fn() } }));
vi.mock('../../../utils/appPaths', () => ({ getPackageRoot: () => path.resolve('packages/electron') }));
vi.mock('../../../file/WorkspaceEventBus', () => ({
  subscribe: async (_workspace: string, _id: string, callbacks: any) => {
    fixture.observed = callbacks.onObserved;
    callbacks.onHealthChanged({ state: 'watching' });
  },
  unsubscribe: vi.fn(), getSubscriberIds: (workspace: string) => ['shell-hooks:' + workspace], drainWorkspaceEvents: async () => {},
}));
vi.mock('../../../file/knownFileWrites', () => ({ contentFingerprint: () => 'fingerprint', isKnownFileWrite: () => false }));
vi.mock('../../../utils/fileFilters', () => ({ shouldExcludePath: () => true }));
vi.mock('../../WorkspaceFileAttributionPolicy', () => ({ workspaceFileAttributionPolicy: { getSessionIds: () => [] } }));
vi.mock('../../SessionEditQuota', () => ({ sessionEditQuota: { tryReserve: async () => true } }));
vi.mock('../../WorkspaceAttributionThrottle', () => ({ workspaceAttributionThrottle: { tryAcquire: () => true } }));
vi.mock('../../sessionFilesNotify', () => ({ notifySessionFilesUpdated: vi.fn() }));
vi.mock('../../../utils/logger', () => ({ logger: { main: { warn: vi.fn(), debug: vi.fn() } } }));
vi.mock('../ShellCheckoutBaseline', () => ({ prepareShellCheckoutBaseline: async () => undefined }));
vi.mock('../shellCoverageStore', () => ({ createShellCoverageStore: () => ({ load: async () => undefined, save: async () => {} }) }));
vi.mock('../../../database/PGLiteDatabaseWorker', () => ({ database: {} }));

import { prepareShellTracking, shellFileAttribution, shellTrackingCoverage } from '../codexShellTrackingHost';

let registration: Awaited<ReturnType<typeof prepareShellTracking>>;
afterEach(async () => {
  registration?.dispose();
  await shellFileAttribution.drain(['host-test']);
  await shellTrackingCoverage.flush(['host-test']);
  vi.restoreAllMocks();
});

it('forwards only hook identity through the executable hook and records a foreign turn without fencing', async () => {
  registration = await prepareShellTracking('host-test', '/workspace');
  registration!.turnStarted('root-turn');
  const pre = vi.spyOn(shellFileAttribution, 'pre');
  const post = vi.spyOn(shellFileAttribution, 'post');
  const hook = (event: string) => new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [path.resolve('packages/electron/resources/codex-shell-hook.cjs')], {
      env: { ...process.env, ...registration!.env }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Hook exited ${code}`)));
    child.stdin.end(JSON.stringify({ hook_event_name: event, tool_use_id: 'foreign', tool_name: 'Bash', session_id: 'child-session', turn_id: 'child-turn', agent_type: 'worker', tool_input: { command: 'private command' } }));
  });
  await hook('PreToolUse');
  expect(pre).toHaveBeenCalledWith(expect.any(String), 'foreign', 'Bash', { sessionId: 'child-session', turnId: 'child-turn', agentType: 'worker' });
  expect(shellFileAttribution.getStats().activeWindows).toBe(1);
  fixture.observed!('change', '/workspace/excluded.ts', Date.now() + 1);
  await shellFileAttribution.flush();
  registration!.endTurn();
  const [coverage] = await shellTrackingCoverage.readMany(['host-test']);
  expect(coverage.events).toContainEqual(expect.objectContaining({ reason: 'unmatchedTool', tool: 'Bash', hookTurnId: 'child-turn', turnMatched: false, agentType: 'worker', hookSessionId: 'child-session' }));
  await hook('PostToolUse');
  expect(post).toHaveBeenCalledWith(expect.any(String), 'foreign', { sessionId: 'child-session', turnId: 'child-turn', agentType: 'worker', tool: 'Bash' });
});

it('accepts legacy hooks and rejects invalid optional identities at the HTTP boundary', async () => {
  registration = await prepareShellTracking('validation-test', '/workspace');
  const send = (fields: Record<string, unknown>) => fetch(registration!.env.NIMBALYST_SHELL_HOOK_URL, {
    method: 'POST', body: JSON.stringify({ event: 'PreToolUse', id: 'legacy', tool: 'Bash', ...fields }),
  });
  expect((await send({})).status).toBe(200);
  for (const field of ['session_id', 'turn_id', 'agent_type']) {
    expect((await send({ [field]: 1 })).status).toBe(400);
    expect((await send({ [field]: 'x'.repeat(257) })).status).toBe(400);
  }
  await shellTrackingCoverage.flush(['validation-test']);
});
