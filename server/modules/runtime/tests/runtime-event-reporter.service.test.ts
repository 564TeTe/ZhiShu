import assert from 'node:assert/strict';
import test from 'node:test';

import type { RuntimeEvent, RuntimeEventOutboxEntry } from '@/shared/types.js';

import { createRuntimeEventReporter } from '../runtime-event-reporter.service.js';

function event(sequenceNo: number): RuntimeEvent {
  return {
    protocolVersion: '1.0',
    eventId: `event-${sequenceNo}`,
    taskId: 'task-1',
    attemptId: 'attempt-1',
    runtimeRunId: 'run-1',
    sequenceNo,
    occurredAt: `2026-08-12T08:00:0${sequenceNo}.000Z`,
    type: sequenceNo === 1 ? 'RUN_STARTED' : 'RUN_COMPLETED',
    payload: {},
  };
}

function createMemoryOutbox() {
  const entries = new Map<string, RuntimeEventOutboxEntry>();

  return {
    enqueue(events: RuntimeEvent[], now: number) {
      let inserted = 0;
      let duplicates = 0;
      for (const runtimeEvent of events) {
        if (entries.has(runtimeEvent.eventId)) {
          duplicates += 1;
        } else {
          entries.set(runtimeEvent.eventId, {
            event: runtimeEvent,
            attempts: 0,
            nextAttemptAt: now,
            lastError: null,
            createdAt: now,
          });
          inserted += 1;
        }
      }
      return { inserted, duplicates };
    },
    findNextReady(now: number) {
      return [...entries.values()]
        .filter((candidate) => candidate.nextAttemptAt <= now)
        .filter((candidate) => ![...entries.values()].some(
          (earlier) => earlier.event.runtimeRunId === candidate.event.runtimeRunId
            && earlier.event.sequenceNo < candidate.event.sequenceNo,
        ))
        .sort((left, right) => left.event.sequenceNo - right.event.sequenceNo)[0] ?? null;
    },
    findNextAvailableAt() {
      const firstPerRun = [...entries.values()].filter(
        (candidate) => ![...entries.values()].some(
          (earlier) => earlier.event.runtimeRunId === candidate.event.runtimeRunId
            && earlier.event.sequenceNo < candidate.event.sequenceNo,
        ),
      );
      return firstPerRun.length > 0
        ? Math.min(...firstPerRun.map((entry) => entry.nextAttemptAt))
        : null;
    },
    markFailed(eventId: string, nextAttemptAt: number, error: string) {
      const entry = entries.get(eventId);
      assert.ok(entry);
      entries.set(eventId, {
        ...entry,
        attempts: entry.attempts + 1,
        nextAttemptAt,
        lastError: error,
      });
    },
    markDelivered(eventId: string) {
      entries.delete(eventId);
    },
    countPending() {
      return entries.size;
    },
    getStats(now: number) {
      const values = [...entries.values()];
      const failed = values
        .filter((entry) => entry.lastError)
        .sort((left, right) => right.attempts - left.attempts)[0];
      return {
        pendingCount: values.length,
        dueCount: values.filter((entry) => entry.nextAttemptAt <= now).length,
        oldestCreatedAt: values.length > 0
          ? Math.min(...values.map((entry) => entry.createdAt))
          : null,
        maxAttempts: values.length > 0 ? Math.max(...values.map((entry) => entry.attempts)) : 0,
        lastError: failed?.lastError ?? null,
      };
    },
    entries,
  };
}

test('report persists before delivery and start resumes pending events', async () => {
  const outbox = createMemoryOutbox();
  const delivered: string[] = [];
  const reporter = createRuntimeEventReporter({
    outbox,
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { events: RuntimeEvent[] };
      delivered.push(body.events[0].eventId);
      return new Response(null, { status: 202 });
    },
    getControlPlaneBaseUrl: () => 'http://control-plane',
    getRuntimeToken: () => 'secret',
    now: () => 1_000,
    setTimer: () => ({}) as ReturnType<typeof setTimeout>,
    clearTimer: () => undefined,
  });

  await reporter.report([event(1)]);
  assert.equal(outbox.countPending(), 1);
  assert.deepEqual(delivered, []);

  reporter.start();
  await reporter.flushReady();
  assert.deepEqual(delivered, ['event-1']);
  assert.equal(outbox.countPending(), 0);
  await reporter.stop();
});

test('failed delivery backs off and blocks later sequence until retry succeeds', async () => {
  const outbox = createMemoryOutbox();
  const deliveries: string[] = [];
  let now = 1_000;
  let shouldFail = true;
  const reporter = createRuntimeEventReporter({
    outbox,
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { events: RuntimeEvent[] };
      deliveries.push(body.events[0].eventId);
      if (shouldFail) throw new Error('control plane unavailable');
      return new Response(null, { status: 202 });
    },
    getControlPlaneBaseUrl: () => 'http://control-plane',
    getRuntimeToken: () => 'secret',
    now: () => now,
    random: () => 0.5,
    setTimer: () => ({}) as ReturnType<typeof setTimeout>,
    clearTimer: () => undefined,
  });

  reporter.start();
  await reporter.report([event(1), event(2)]);
  await reporter.flushReady();

  assert.deepEqual(deliveries, ['event-1']);
  assert.equal(outbox.entries.get('event-1')?.attempts, 1);
  assert.equal(outbox.entries.get('event-1')?.nextAttemptAt, 2_000);
  assert.equal(outbox.entries.get('event-2')?.attempts, 0);
  assert.deepEqual(reporter.getHealth(), {
    status: 'degraded',
    started: true,
    configurationReady: true,
    missingConfiguration: [],
    invalidConfiguration: [],
    pendingEvents: 2,
    dueEvents: 1,
    oldestEventAgeMs: 0,
    maxAttempts: 1,
    lastError: 'control plane unavailable',
  });

  shouldFail = false;
  now = 2_000;
  await reporter.flushReady();

  assert.deepEqual(deliveries, ['event-1', 'event-1', 'event-2']);
  assert.equal(outbox.countPending(), 0);
  await reporter.stop();
});

test('preflight reports missing and invalid delivery configuration without exposing secrets', () => {
  const reporter = createRuntimeEventReporter({
    outbox: createMemoryOutbox(),
    getControlPlaneBaseUrl: () => 'file:///not-http',
    getRuntimeToken: () => null,
    now: () => 1_000,
    setTimer: () => ({}) as ReturnType<typeof setTimeout>,
    clearTimer: () => undefined,
  });

  assert.deepEqual(reporter.getHealth(), {
    status: 'misconfigured',
    started: false,
    configurationReady: false,
    missingConfiguration: ['ZS_RUNTIME_TOKEN'],
    invalidConfiguration: ['ZHISHU_CONTROL_BASE_URL'],
    pendingEvents: 0,
    dueEvents: 0,
    oldestEventAgeMs: null,
    maxAttempts: 0,
    lastError: null,
  });
  assert.throws(
    () => reporter.assertReadyForStart(),
    (error: unknown) => error instanceof Error
      && 'code' in error
      && error.code === 'RUNTIME_EVENT_DELIVERY_NOT_READY'
      && !JSON.stringify(error).includes('secret'),
  );
});
