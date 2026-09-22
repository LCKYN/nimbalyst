// @vitest-environment node
/**
 * Round-trip for scheduled-prompt attachments (#1497) against a REAL migrated
 * SQLite database, not a mock.
 *
 * Three things can only break here: migration 0045 not reaching a fresh
 * install, the Postgres-style `$7` placeholder not surviving dialect
 * translation, and the JSON column coming back as a string that nobody parses.
 * Each one silently loses the user's image rather than throwing, which is why
 * this asserts the value that comes back out rather than that create() resolved.
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SQLiteDatabase } from '../../database/sqlite/SQLiteDatabase';
import { createSQLiteStoreAdapter } from '../../database/sqlite/SQLiteStoreAdapter';
import { createPGLiteSessionWakeupsStore } from '../PGLiteSessionWakeupsStore';

async function withStore<T>(
  run: (store: ReturnType<typeof createPGLiteSessionWakeupsStore>, sqlite: SQLiteDatabase) => Promise<T>,
): Promise<T> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nim-wakeup-attach-'));
  const sqlite = new SQLiteDatabase({
    dbDir: tmpDir,
    schemaDir: path.resolve(__dirname, '..', '..', 'database', 'sqlite', 'schemas'),
    slowQueryThresholdMs: 1000,
    sampleRate: 0,
  });
  try {
    await sqlite.initialize();
    // A wakeup FKs to ai_sessions, so the session has to exist first.
    await sqlite.query(
      `INSERT INTO ai_sessions (id, title, workspace_id, provider) VALUES ($1, $2, $3, $4)`,
      ['s1', 'Test session', '/w', 'claude-code'],
    );
    const store = createPGLiteSessionWakeupsStore(createSQLiteStoreAdapter(sqlite));
    return await run(store, sqlite);
  } finally {
    try {
      await sqlite.close();
    } catch {
      // best effort
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe('scheduled prompt attachments', () => {
  it('adds the attachments column to a freshly migrated database', async () => {
    await withStore(async (_store, sqlite) => {
      const { rows } = await sqlite.query<{ name: string; type: string }>(
        `SELECT name, type FROM pragma_table_info('ai_session_wakeups')`,
      );
      const column = rows.find((r) => r.name === 'attachments');
      expect(column).toBeDefined();
      expect(column?.type).toBe('TEXT');
    });
  });

  it('round-trips attachments through create and read-back', async () => {
    await withStore(async (store) => {
      const attachments = [
        { id: 'a1', filename: 'screenshot.png', type: 'image' },
        { id: 'a2', filename: 'spec.pdf', type: 'pdf' },
      ];
      const created = await store.create({
        id: 'wakeup-1',
        sessionId: 's1',
        workspaceId: '/w',
        prompt: 'look at this',
        fireAt: Date.now() + 3_600_000,
        attachments,
      });
      expect(created.attachments).toEqual(attachments);

      const reloaded = await store.get('wakeup-1');
      expect(reloaded?.attachments).toEqual(attachments);
    });
  });

  it('survives the status transitions the scheduler drives', async () => {
    await withStore(async (store) => {
      const attachments = [{ id: 'a1', filename: 'shot.png', type: 'image' }];
      await store.create({
        id: 'wakeup-2',
        sessionId: 's1',
        workspaceId: '/w',
        prompt: 'fire me',
        fireAt: Date.now() + 3_600_000,
        attachments,
      });

      // markFiring is what hands the row to the executor, which is where the
      // attachments have to still be present for them to reach the prompt.
      const firing = await store.markFiring('wakeup-2');
      expect(firing?.attachments).toEqual(attachments);
    });
  });

  it('reports no attachments for a wakeup scheduled without any', async () => {
    await withStore(async (store) => {
      const created = await store.create({
        id: 'wakeup-3',
        sessionId: 's1',
        workspaceId: '/w',
        prompt: 'plain text only',
        fireAt: Date.now() + 3_600_000,
      });
      expect(created.attachments).toEqual([]);

      const reloaded = await store.get('wakeup-3');
      expect(reloaded?.attachments).toEqual([]);
    });
  });
});
