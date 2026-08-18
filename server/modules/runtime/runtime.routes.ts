import crypto from 'node:crypto';
import path from 'node:path';

import express from 'express';

import type {
  AnyRecord,
  RuntimeApprovalDecisionCommand,
  RuntimeCancelCommand,
  RuntimeCapability,
  RuntimeStartCommand,
} from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

import type { createRuntimeService } from './runtime.service.js';

const CAPABILITIES = new Set<RuntimeCapability>([
  'READ_FILE',
  'WRITE_FILE',
  'SEARCH_CODE',
  'SHELL',
  'GIT',
  'TEST',
]);

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AppError(`${field} is required.`, { code: 'INVALID_RUNTIME_COMMAND', statusCode: 400 });
  }
  return value.trim();
}

function parseCapabilities(value: unknown): RuntimeCapability[] {
  if (!Array.isArray(value) || value.some((entry) => !CAPABILITIES.has(entry as RuntimeCapability))) {
    throw new AppError('capabilities contains an unsupported value.', {
      code: 'UNSUPPORTED_CAPABILITY',
      statusCode: 422,
    });
  }
  return [...new Set(value as RuntimeCapability[])];
}

function parseStartCommand(body: unknown): RuntimeStartCommand {
  const input = (body && typeof body === 'object' ? body : {}) as AnyRecord;
  if (input.protocolVersion !== '1.0') {
    throw new AppError('Only Runtime Protocol version 1.0 is supported.', {
      code: 'PROTOCOL_VERSION_UNSUPPORTED',
      statusCode: 400,
    });
  }
  const capabilities = parseCapabilities(input.capabilities);
  const policyInput = input.permissionPolicy as AnyRecord | undefined;
  const requireApprovalFor = parseCapabilities(policyInput?.requireApprovalFor ?? []);
  const mode = policyInput?.mode;
  if (mode !== 'MANUAL' && mode !== 'AUTO_SAFE' && mode !== 'AUTO_TRUSTED') {
    throw new AppError('permissionPolicy.mode is invalid.', { code: 'INVALID_PERMISSION_POLICY', statusCode: 422 });
  }
  const projectRoot = requiredString(policyInput?.projectRoot, 'permissionPolicy.projectRoot');
  const allowedDirectories = policyInput?.allowedDirectories;
  if (!Array.isArray(allowedDirectories) || allowedDirectories.length === 0
    || allowedDirectories.some(value => typeof value !== 'string' || !value.trim()
      || path.isAbsolute(value) || path.normalize(value).startsWith('..'))) {
    throw new AppError('permissionPolicy.allowedDirectories must contain relative directories.', {
      code: 'INVALID_PERMISSION_POLICY', statusCode: 422,
    });
  }
  const trustedCommands = policyInput?.trustedCommands;
  if (!Array.isArray(trustedCommands) || trustedCommands.some(command => !Array.isArray(command)
    || command.length === 0 || command.some(token => typeof token !== 'string' || !token.trim()))) {
    throw new AppError('permissionPolicy.trustedCommands must contain exact argv token arrays.', {
      code: 'INVALID_PERMISSION_POLICY', statusCode: 422,
    });
  }
  const approvalTimeoutSeconds = policyInput?.approvalTimeoutSeconds;
  if (!Number.isInteger(approvalTimeoutSeconds) || approvalTimeoutSeconds < 5 || approvalTimeoutSeconds > 300) {
    throw new AppError('permissionPolicy.approvalTimeoutSeconds must be between 5 and 300.', {
      code: 'INVALID_PERMISSION_POLICY', statusCode: 422,
    });
  }
  if (requireApprovalFor.some((capability) => !capabilities.includes(capability))) {
    throw new AppError('Approval policy cannot reference a disabled capability.', {
      code: 'INVALID_PERMISSION_POLICY',
      statusCode: 422,
    });
  }

  return {
    protocolVersion: '1.0',
    requestId: requiredString(input.requestId, 'requestId'),
    idempotencyKey: requiredString(input.idempotencyKey, 'idempotencyKey'),
    taskId: requiredString(input.taskId, 'taskId'),
    attemptId: requiredString(input.attemptId, 'attemptId'),
    projectRef: requiredString(input.projectRef, 'projectRef'),
    executor: requiredString(input.executor, 'executor') as RuntimeStartCommand['executor'],
    modelAlias: typeof input.modelAlias === 'string' ? input.modelAlias.trim() || null : null,
    connectionRef: typeof input.connectionRef === 'string' ? input.connectionRef.trim() || null : null,
    objective: requiredString(input.objective, 'objective'),
    capabilities,
    permissionPolicy: {
      requireApprovalFor,
      mode,
      projectRoot,
      allowedDirectories: allowedDirectories.map(value => String(value).trim()),
      trustedCommands: trustedCommands.map(command => command.map((token: unknown) => String(token).trim())),
      approvalTimeoutSeconds,
    },
    context: input.context && typeof input.context === 'object' ? input.context : undefined,
  };
}

function parseControlCommand(body: unknown): RuntimeCancelCommand {
  const input = (body && typeof body === 'object' ? body : {}) as AnyRecord;
  if (input.protocolVersion !== '1.0') {
    throw new AppError('Only Runtime Protocol version 1.0 is supported.', {
      code: 'PROTOCOL_VERSION_UNSUPPORTED',
      statusCode: 400,
    });
  }
  return {
    protocolVersion: '1.0',
    requestId: requiredString(input.requestId, 'requestId'),
    idempotencyKey: requiredString(input.idempotencyKey, 'idempotencyKey'),
  };
}

function parseApprovalDecisionCommand(body: unknown): RuntimeApprovalDecisionCommand {
  const input = (body && typeof body === 'object' ? body : {}) as AnyRecord;
  const command = parseControlCommand(input);
  if (input.decision !== 'APPROVED' && input.decision !== 'DENIED') {
    throw new AppError('decision must be APPROVED or DENIED.', {
      code: 'INVALID_APPROVAL_DECISION',
      statusCode: 400,
    });
  }
  return {
    ...command,
    decision: input.decision,
    message: typeof input.message === 'string' ? input.message : undefined,
    decisionSource: typeof input.decisionSource === 'string' ? input.decisionSource : undefined,
    policy: typeof input.policy === 'string' ? input.policy : undefined,
    rule: typeof input.rule === 'string' ? input.rule : undefined,
    reason: typeof input.reason === 'string' ? input.reason : undefined,
  };
}

function authorizeRuntimeRequest(
  req: express.Request,
  _res: express.Response,
  next: express.NextFunction,
): void {
  const configuredToken = process.env.ZS_RUNTIME_TOKEN?.trim();
  if (!configuredToken) {
    next(new AppError('Runtime internal API authentication is not configured.', {
      code: 'RUNTIME_AUTH_NOT_CONFIGURED',
      statusCode: 503,
    }));
    return;
  }

  const suppliedToken = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice('Bearer '.length)
    : '';
  const expected = Buffer.from(configuredToken);
  const supplied = Buffer.from(suppliedToken);
  if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) {
    next(new AppError('Invalid Runtime API token.', { code: 'RUNTIME_UNAUTHORIZED', statusCode: 401 }));
    return;
  }

  next();
}

/** Creates thin Runtime Protocol v1 HTTP handlers around the Runtime application service. */
export function createRuntimeRouter(
  service: ReturnType<typeof createRuntimeService>,
): express.Router {
  const router = express.Router();
  router.use(authorizeRuntimeRequest);

  router.get('/health', (_req, res) => {
    res.json(service.getEventDeliveryHealth());
  });

  router.post('/runs', async (req, res, next) => {
    try {
      res.status(202).json(await service.start(parseStartCommand(req.body)));
    } catch (error) {
      next(error);
    }
  });

  router.post('/runs/:runtimeRunId/cancel', async (req, res, next) => {
    try {
      res.json(await service.cancel(
        requiredString(req.params.runtimeRunId, 'runtimeRunId'),
        parseControlCommand(req.body),
      ));
    } catch (error) {
      next(error);
    }
  });

  router.post('/runs/:runtimeRunId/approvals/:runtimeApprovalId/decision', async (req, res, next) => {
    try {
      const command = parseApprovalDecisionCommand(req.body);
      res.json(await service.decideApproval(
        requiredString(req.params.runtimeRunId, 'runtimeRunId'),
        requiredString(req.params.runtimeApprovalId, 'runtimeApprovalId'),
        command,
      ));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
