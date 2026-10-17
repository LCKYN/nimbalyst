// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { query, getAppSetting } = vi.hoisted(() => ({ query: vi.fn(), getAppSetting: vi.fn() }));
vi.mock('../../database/PGLiteDatabaseWorker', () => ({ database: { query } }));
vi.mock('../../utils/store', () => ({ getAppSetting }));

import { assertChildSpawnCapacity } from '../metaAgentSessionQueries';

function withCounts(inFlight: number, total = inFlight) {
  query.mockResolvedValue({ rows: [{ in_flight: String(inFlight), total: String(total) }] });
}

describe('assertChildSpawnCapacity in-flight cap', () => {
  beforeEach(() => {
    query.mockReset();
    getAppSetting.mockReset();
  });

  it('defaults to 10 when the setting is unset', async () => {
    withCounts(9);
    await expect(assertChildSpawnCapacity('/ws', 'parent')).resolves.toBeUndefined();
    withCounts(10);
    await expect(assertChildSpawnCapacity('/ws', 'parent')).rejects.toThrow('10/10 in flight');
  });

  it('honors the user setting', async () => {
    getAppSetting.mockReturnValue(4);
    withCounts(4);
    await expect(assertChildSpawnCapacity('/ws', 'parent')).rejects.toThrow('4/4 in flight');
  });

  it('falls back to the default for an invalid stored value', async () => {
    getAppSetting.mockReturnValue(0);
    withCounts(5);
    await expect(assertChildSpawnCapacity('/ws', 'parent')).resolves.toBeUndefined();
  });
});
