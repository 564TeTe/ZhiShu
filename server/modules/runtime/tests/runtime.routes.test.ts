import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import express, { type NextFunction, type Request, type Response } from 'express';

import type { RuntimeEventDeliveryHealth } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

import { createRuntimeRouter } from '../runtime.routes.js';
import { createRuntimeService } from '../runtime.service.js';

async function withServer(
  run: (baseUrl: string) => Promise<void>,
  eventReporter: {
    report(): Promise<void>;
    assertReadyForStart?(): void;
    getHealth?(): RuntimeEventDeliveryHealth;
  } = { async report() {} },
): Promise<void> {
  const app = express();
  app.use(express.json());
  const service = createRuntimeService({
    providerRuntime: {
      hasRuntime: () => true,
      async run(_provider, _prompt, _options, writer) {
        writer.send({ kind: 'complete', exitCode: 0 });
      },
      async abort() { return true; },
      resolveToolApproval() {},
    },
    commandDedup: {
      updateResponse() {},
      inspect: () => ({ outcome: 'missing', response: null }),
      accept: (input) => ({ outcome: 'created', response: input.response }),
    },
    eventReporter,
    workspaceExists: async () => true,
    createId: () => 'fixed-id',
  });
  app.use('/internal/runtime/v1', createRuntimeRouter(service));
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({
        code: error.code,
        message: error.message,
        details: error.details,
      });
      return;
    }
    res.status(500).json({ code: 'INTERNAL_ERROR' });
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('Runtime routes require the internal bearer token', async () => {
  const previousToken = process.env.ZS_RUNTIME_TOKEN;
  process.env.ZS_RUNTIME_TOKEN = 'runtime-secret';
  try {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/internal/runtime/v1/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      assert.equal(response.status, 401);
      assert.equal((await response.json() as { code: string }).code, 'RUNTIME_UNAUTHORIZED');
    });
  } finally {
    if (previousToken === undefined) delete process.env.ZS_RUNTIME_TOKEN;
    else process.env.ZS_RUNTIME_TOKEN = previousToken;
  }
});

test('Runtime Start validates protocol version before dispatch', async () => {
  const previousToken = process.env.ZS_RUNTIME_TOKEN;
  process.env.ZS_RUNTIME_TOKEN = 'runtime-secret';
  try {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/internal/runtime/v1/runs`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer runtime-secret',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ protocolVersion: '2.0' }),
      });
      assert.equal(response.status, 400);
      assert.equal((await response.json() as { code: string }).code, 'PROTOCOL_VERSION_UNSUPPORTED');
    });
  } finally {
    if (previousToken === undefined) delete process.env.ZS_RUNTIME_TOKEN;
    else process.env.ZS_RUNTIME_TOKEN = previousToken;
  }
});

test('Runtime Start accepts a valid version 1 command with HTTP 202', async () => {
  const previousToken = process.env.ZS_RUNTIME_TOKEN;
  process.env.ZS_RUNTIME_TOKEN = 'runtime-secret';
  try {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/internal/runtime/v1/runs`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer runtime-secret',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          protocolVersion: '1.0',
          requestId: 'request-1',
          idempotencyKey: 'attempt-1:start',
          taskId: 'task-1',
          attemptId: 'attempt-1',
          projectRef: 'D:\\workspace\\demo',
          executor: 'claude',
          objective: '修复测试',
          capabilities: ['READ_FILE', 'TEST'],
          permissionPolicy: {
            requireApprovalFor: [], mode: 'MANUAL', projectRoot: 'D:\\workspace\\demo',
            allowedDirectories: ['.'], trustedCommands: [], approvalTimeoutSeconds: 45,
          },
        }),
      });
      assert.equal(response.status, 202);
      assert.deepEqual(await response.json(), { runtimeRunId: 'run_fixed-id', accepted: true });
    });
  } finally {
    if (previousToken === undefined) delete process.env.ZS_RUNTIME_TOKEN;
    else process.env.ZS_RUNTIME_TOKEN = previousToken;
  }
});

test('Runtime Start rejects formal tasks before dispatch when event delivery is not ready', async () => {
  const previousToken = process.env.ZS_RUNTIME_TOKEN;
  process.env.ZS_RUNTIME_TOKEN = 'runtime-secret';
  try {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/internal/runtime/v1/runs`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer runtime-secret',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          protocolVersion: '1.0',
          requestId: 'request-preflight',
          idempotencyKey: 'attempt-preflight:start',
          taskId: 'task-preflight',
          attemptId: 'attempt-preflight',
          projectRef: 'D:\\workspace\\demo',
          executor: 'claude',
          objective: '验证配置预检',
          capabilities: ['READ_FILE'],
          permissionPolicy: {
            requireApprovalFor: [], mode: 'MANUAL', projectRoot: 'D:\\workspace\\demo',
            allowedDirectories: ['.'], trustedCommands: [], approvalTimeoutSeconds: 45,
          },
        }),
      });
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), {
        code: 'RUNTIME_EVENT_DELIVERY_NOT_READY',
        message: 'Runtime event delivery is not configured for formal Agent tasks.',
        details: {
          missingConfiguration: ['ZHISHU_CONTROL_BASE_URL'],
          invalidConfiguration: [],
        },
      });
    }, {
      async report() {},
      assertReadyForStart() {
        throw new AppError('Runtime event delivery is not configured for formal Agent tasks.', {
          code: 'RUNTIME_EVENT_DELIVERY_NOT_READY',
          statusCode: 503,
          details: {
            missingConfiguration: ['ZHISHU_CONTROL_BASE_URL'],
            invalidConfiguration: [],
          },
        });
      },
    });
  } finally {
    if (previousToken === undefined) delete process.env.ZS_RUNTIME_TOKEN;
    else process.env.ZS_RUNTIME_TOKEN = previousToken;
  }
});

test('Runtime health requires internal authentication and returns a secret-free snapshot', async () => {
  const previousToken = process.env.ZS_RUNTIME_TOKEN;
  process.env.ZS_RUNTIME_TOKEN = 'runtime-secret';
  const health = {
    status: 'up' as const,
    started: true,
    configurationReady: true,
    missingConfiguration: [],
    invalidConfiguration: [],
    pendingEvents: 0,
    dueEvents: 0,
    oldestEventAgeMs: null,
    maxAttempts: 0,
    lastError: null,
  };
  try {
    await withServer(async (baseUrl) => {
      assert.equal((await fetch(`${baseUrl}/internal/runtime/v1/health`)).status, 401);
      const response = await fetch(`${baseUrl}/internal/runtime/v1/health`, {
        headers: { Authorization: 'Bearer runtime-secret' },
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.deepEqual(body, health);
      assert.doesNotMatch(JSON.stringify(body), /runtime-secret/);
    }, {
      async report() {},
      getHealth: () => health,
    });
  } finally {
    if (previousToken === undefined) delete process.env.ZS_RUNTIME_TOKEN;
    else process.env.ZS_RUNTIME_TOKEN = previousToken;
  }
});
