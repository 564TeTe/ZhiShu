import { runtimeEventOutboxDb } from '@/modules/database/index.js';
import type {
  RuntimeEvent,
  RuntimeEventBatch,
  RuntimeEventDeliveryHealth,
  RuntimeEventOutboxEntry,
  RuntimeEventOutboxStats,
} from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

type RuntimeEventOutbox = {
  enqueue(events: RuntimeEvent[], now: number): { inserted: number; duplicates: number };
  findNextReady(now: number): RuntimeEventOutboxEntry | null;
  findNextAvailableAt(): number | null;
  markFailed(eventId: string, nextAttemptAt: number, error: string): void;
  markDelivered(eventId: string): void;
  countPending(): number;
  getStats(now: number): RuntimeEventOutboxStats;
};

type RuntimeEventReporterDependencies = {
  fetch: typeof globalThis.fetch;
  outbox: RuntimeEventOutbox;
  getControlPlaneBaseUrl(): string | null;
  getRuntimeToken(): string | null;
  now(): number;
  random(): number;
  setTimer(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  clearTimer(timer: ReturnType<typeof setTimeout>): void;
};

const RETRY_BASE_DELAY_MS = 1_000;
const RETRY_MAX_DELAY_MS = 60_000;
const DELIVERY_TIMEOUT_MS = 5_000;

const defaultDependencies: RuntimeEventReporterDependencies = {
  fetch: globalThis.fetch,
  outbox: runtimeEventOutboxDb,
  getControlPlaneBaseUrl: () => process.env.ZHISHU_CONTROL_BASE_URL?.trim() || null,
  getRuntimeToken: () => process.env.ZS_RUNTIME_TOKEN?.trim() || null,
  now: () => Date.now(),
  random: () => Math.random(),
  setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimer: (timer) => clearTimeout(timer),
};

function retryDelay(attempts: number, random: number): number {
  const exponential = Math.min(
    RETRY_MAX_DELAY_MS,
    RETRY_BASE_DELAY_MS * (2 ** Math.min(Math.max(attempts - 1, 0), 10)),
  );
  return Math.round(exponential * (0.8 + Math.min(Math.max(random, 0), 1) * 0.4));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function configurationIssues(dependencies: RuntimeEventReporterDependencies): {
  missingConfiguration: string[];
  invalidConfiguration: string[];
} {
  const missingConfiguration: string[] = [];
  const invalidConfiguration: string[] = [];
  const baseUrl = dependencies.getControlPlaneBaseUrl();
  const token = dependencies.getRuntimeToken();

  if (!baseUrl) {
    missingConfiguration.push('ZHISHU_CONTROL_BASE_URL');
  } else {
    try {
      const parsed = new URL(baseUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        invalidConfiguration.push('ZHISHU_CONTROL_BASE_URL');
      }
    } catch {
      invalidConfiguration.push('ZHISHU_CONTROL_BASE_URL');
    }
  }
  if (!token) missingConfiguration.push('ZS_RUNTIME_TOKEN');
  return { missingConfiguration, invalidConfiguration };
}

/**
 * Creates the durable Runtime event reporter used by runtime.service and tests.
 *
 * `report` commits events to SQLite before returning. A background delivery
 * loop sends the lowest pending sequence from each Runtime run, deletes it only
 * after a successful HTTP response, and retries failures with jittered
 * exponential backoff. Calling `start` after database initialization resumes
 * records left by an earlier Node process.
 */
export function createRuntimeEventReporter(
  dependencyOverrides: Partial<RuntimeEventReporterDependencies> = {},
) {
  const dependencies = { ...defaultDependencies, ...dependencyOverrides };
  let started = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let activeFlush: Promise<void> | null = null;

  function clearScheduledFlush(): void {
    if (!timer) return;
    dependencies.clearTimer(timer);
    timer = null;
  }

  function schedule(delayMs: number): void {
    if (!started) return;
    clearScheduledFlush();
    timer = dependencies.setTimer(() => {
      timer = null;
      void flushReady();
    }, Math.max(0, delayMs));
  }

  function scheduleFromOutbox(): void {
    if (!started) return;
    const nextAttemptAt = dependencies.outbox.findNextAvailableAt();
    if (nextAttemptAt == null) return;
    schedule(Math.min(Math.max(0, nextAttemptAt - dependencies.now()), RETRY_MAX_DELAY_MS));
  }

  async function deliver(entry: RuntimeEventOutboxEntry): Promise<void> {
    const baseUrl = dependencies.getControlPlaneBaseUrl();
    if (!baseUrl) {
      throw new Error('ZHISHU_CONTROL_BASE_URL is required for Runtime event delivery.');
    }

    const token = dependencies.getRuntimeToken();
    if (!token) {
      throw new Error('ZS_RUNTIME_TOKEN is required for Runtime event delivery.');
    }

    const batch: RuntimeEventBatch = { protocolVersion: '1.0', events: [entry.event] };
    const response = await dependencies.fetch(
      `${baseUrl.replace(/\/+$/, '')}/internal/control/v1/events:batch`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(batch),
        signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
      },
    );

    if (!response.ok) {
      throw new Error(`Control Plane rejected Runtime events with HTTP ${response.status}.`);
    }
  }

  async function runFlush(): Promise<void> {
    while (started) {
      const entry = dependencies.outbox.findNextReady(dependencies.now());
      if (!entry) break;

      try {
        await deliver(entry);
        dependencies.outbox.markDelivered(entry.event.eventId);
      } catch (error) {
        const attempts = entry.attempts + 1;
        const message = errorMessage(error);
        dependencies.outbox.markFailed(
          entry.event.eventId,
          dependencies.now() + retryDelay(attempts, dependencies.random()),
          message,
        );
        if (attempts === 1 || attempts % 5 === 0) {
          console.warn('[RuntimeOutbox] Event delivery deferred', {
            eventId: entry.event.eventId,
            runtimeRunId: entry.event.runtimeRunId,
            sequenceNo: entry.event.sequenceNo,
            attempts,
            error: message,
          });
        }
      }
    }
  }

  function flushReady(): Promise<void> {
    if (activeFlush) return activeFlush;
    activeFlush = runFlush().finally(() => {
      activeFlush = null;
      scheduleFromOutbox();
    });
    return activeFlush;
  }

  return {
    async report(events: RuntimeEvent[]): Promise<void> {
      if (events.length === 0) return;
      dependencies.outbox.enqueue(events, dependencies.now());
      schedule(0);
    },

    start(): void {
      if (started) return;
      started = true;
      const pending = dependencies.outbox.countPending();
      if (pending > 0) {
        console.info('[RuntimeOutbox] Resuming pending event delivery', { pending });
      }
      scheduleFromOutbox();
    },

    assertReadyForStart(): void {
      const issues = configurationIssues(dependencies);
      if (issues.missingConfiguration.length === 0 && issues.invalidConfiguration.length === 0) {
        return;
      }
      throw new AppError('Runtime event delivery is not configured for formal Agent tasks.', {
        code: 'RUNTIME_EVENT_DELIVERY_NOT_READY',
        statusCode: 503,
        details: issues,
      });
    },

    getHealth(): RuntimeEventDeliveryHealth {
      const now = dependencies.now();
      const issues = configurationIssues(dependencies);
      const stats = dependencies.outbox.getStats(now);
      const configurationReady = issues.missingConfiguration.length === 0
        && issues.invalidConfiguration.length === 0;
      return {
        status: !configurationReady ? 'misconfigured' : stats.maxAttempts > 0 ? 'degraded' : 'up',
        started,
        configurationReady,
        ...issues,
        pendingEvents: stats.pendingCount,
        dueEvents: stats.dueCount,
        oldestEventAgeMs: stats.oldestCreatedAt == null ? null : Math.max(0, now - stats.oldestCreatedAt),
        maxAttempts: stats.maxAttempts,
        lastError: stats.lastError,
      };
    },

    async stop(): Promise<void> {
      started = false;
      clearScheduledFlush();
      await activeFlush;
    },

    /** Focused tests use this hook to execute a retry cycle without real timers. */
    async flushReady(): Promise<void> {
      await flushReady();
    },
  };
}

/** Runtime event reporter wired into the production Runtime module. */
export const runtimeEventReporter = createRuntimeEventReporter();
