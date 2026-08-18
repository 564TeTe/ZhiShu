import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, runtimeConnectionsDb } from '@/modules/database/index.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'runtime-connections-db-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(temporaryDirectory, 'auth.db');
  await initializeDatabase();
  try { await runTest(); }
  finally {
    closeConnection();
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

test('runtime connections persist health without exposing credentials and rotate keys', async () => {
  await withIsolatedDatabase(() => {
    const created = runtimeConnectionsDb.create({ id: 'conn_test', name: 'Test', baseUrl: 'https://example.com', apiKey: 'secret-old' });
    assert.equal(created.credentialHint, '****-old');
    assert.equal(runtimeConnectionsDb.list()[0].lastHealthStatus, 'not_checked');
    runtimeConnectionsDb.recordHealth('conn_test', { status: 'auth_failed', code: 401, message: 'Authentication failed', latencyMs: 12 });
    const listed = runtimeConnectionsDb.list()[0];
    assert.equal(listed.lastHealthStatus, 'auth_failed');
    assert.equal(listed.lastHealthCode, 401);
    assert.equal(listed.lastLatencyMs, 12);
    assert.equal(JSON.stringify(listed).includes('secret-old'), false);
    runtimeConnectionsDb.update('conn_test', { apiKey: 'secret-new' });
    assert.equal(runtimeConnectionsDb.get('conn_test')?.apiKey, 'secret-new');
  });
});
