import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  closeConnection,
  initializeDatabase,
  runtimeEventOutboxDb,
} from '@/modules/database/index.js';
import type { RuntimeEvent } from '@/shared/types.js';

function event(sequenceNo: number, eventId = `event-${sequenceNo}`): RuntimeEvent {
  return {
    protocolVersion: '1.0',
    eventId,
    taskId: 'task-1',
    attemptId: 'attempt-1',
    runtimeRunId: 'run-1',
    sequenceNo,
    occurredAt: `2026-08-12T08:00:0${sequenceNo}.000Z`,
    type: sequenceNo === 1 ? 'RUN_STARTED' : 'RUN_COMPLETED',
    payload: { sequenceNo },
  };
}

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'runtime-outbox-db-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  // An empty target prevents the connection helper from copying the user's
  // legacy development database into this isolated test directory.
  await writeFile(databasePath, '');
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

test('runtime event outbox survives restart and releases one run in sequence order', async () => {
  await withIsolatedDatabase(async () => {
    const first = event(1);
    const second = event(2);
    assert.deepEqual(runtimeEventOutboxDb.enqueue([first, second], 1_000), {
      inserted: 2,
      duplicates: 0,
    });
    assert.deepEqual(runtimeEventOutboxDb.enqueue([first], 1_100), {
      inserted: 0,
      duplicates: 1,
    });

    closeConnection();
    await initializeDatabase();

    assert.equal(runtimeEventOutboxDb.countPending(), 2);
    assert.equal(runtimeEventOutboxDb.findNextReady(1_000)?.event.eventId, first.eventId);
    runtimeEventOutboxDb.markDelivered(first.eventId);
    assert.equal(runtimeEventOutboxDb.findNextReady(1_000)?.event.eventId, second.eventId);
    runtimeEventOutboxDb.markDelivered(second.eventId);
    assert.equal(runtimeEventOutboxDb.countPending(), 0);
  });
});

test('runtime event outbox rejects reused run sequence with different content', async () => {
  await withIsolatedDatabase(() => {
    runtimeEventOutboxDb.enqueue([event(1)], 1_000);

    assert.throws(
      () => runtimeEventOutboxDb.enqueue([event(1, 'different-event-id')], 1_000),
      /reused with different content/,
    );
    assert.equal(runtimeEventOutboxDb.countPending(), 1);
  });
});

test('runtime event outbox exposes pending, age, due, attempts, and error statistics', async () => {
  await withIsolatedDatabase(() => {
    runtimeEventOutboxDb.enqueue([event(1), event(2)], 1_000);
    runtimeEventOutboxDb.markFailed('event-1', 2_000, 'control plane unavailable');

    assert.deepEqual(runtimeEventOutboxDb.getStats(1_500), {
      pendingCount: 2,
      dueCount: 1,
      oldestCreatedAt: 1_000,
      maxAttempts: 1,
      lastError: 'control plane unavailable',
    });
    assert.equal(runtimeEventOutboxDb.findNextReady(1_500), null);
  });
});
