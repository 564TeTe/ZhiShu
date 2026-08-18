import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  closeConnection,
  initializeDatabase,
  runtimeCommandDedupDb,
} from '@/modules/database/index.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'runtime-dedup-db-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await initializeDatabase();

  try {
    await runTest();
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

test('runtime command dedup persists response replay and detects payload conflicts', async () => {
  await withIsolatedDatabase(() => {
    const first = runtimeCommandDedupDb.accept({
      idempotencyKey: 'attempt-1:start',
      commandType: 'START',
      requestHash: 'hash-a',
      response: { runtimeRunId: 'run-1', accepted: true },
    });
    const replay = runtimeCommandDedupDb.accept({
      idempotencyKey: 'attempt-1:start',
      commandType: 'START',
      requestHash: 'hash-a',
      response: { runtimeRunId: 'run-2', accepted: true },
    });
    const conflict = runtimeCommandDedupDb.accept({
      idempotencyKey: 'attempt-1:start',
      commandType: 'START',
      requestHash: 'hash-b',
      response: { runtimeRunId: 'run-3', accepted: true },
    });

    assert.equal(first.outcome, 'created');
    assert.equal(replay.outcome, 'replay');
    assert.deepEqual(replay.response, { runtimeRunId: 'run-1', accepted: true });
    assert.equal(conflict.outcome, 'conflict');
    assert.deepEqual(conflict.response, { runtimeRunId: 'run-1', accepted: true });
  });
});
