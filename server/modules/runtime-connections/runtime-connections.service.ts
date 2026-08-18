import { randomUUID } from 'node:crypto';

import { runtimeConnectionsDb } from '@/modules/database/index.js';
import { AppError } from '@/shared/utils.js';

function required(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new AppError(`${field} is required`, { code: 'RUNTIME_CONNECTION_INVALID', statusCode: 400 });
  return value.trim();
}

function url(value: unknown): string {
  const normalized = required(value, 'baseUrl');
  let parsed: URL;
  try { parsed = new URL(normalized); } catch { throw new AppError('baseUrl must be a valid URL', { code: 'RUNTIME_CONNECTION_INVALID', statusCode: 400 }); }
  if (parsed.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(parsed.hostname)) throw new AppError('baseUrl must use HTTPS unless it targets localhost', { code: 'RUNTIME_CONNECTION_INVALID', statusCode: 400 });
  return normalized.replace(/\/$/, '');
}

function headers(value: unknown): Record<string, string> {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('customHeaders must be an object', { code: 'RUNTIME_CONNECTION_INVALID', statusCode: 400 });
  const entries = Object.entries(value).filter(([key, entry]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && typeof entry === 'string');
  return Object.fromEntries(entries) as Record<string, string>;
}

export function createRuntimeConnectionsService(dependencies: { isConnectionInUse?: (connectionRef: string) => boolean } = {}) {
  return {
    list() { return { connections: runtimeConnectionsDb.list() }; },
    create(input: Record<string, unknown>) {
      const apiKey = required(input.apiKey, 'apiKey');
      return { connection: runtimeConnectionsDb.create({ id: `conn_${randomUUID()}`, name: required(input.name, 'name'), baseUrl: url(input.baseUrl), apiKey, defaultModel: typeof input.defaultModel === 'string' ? input.defaultModel.trim() || null : null, customHeaders: headers(input.customHeaders) }) };
    },
    update(id: string, input: Record<string, unknown>) {
      const patch = { name: input.name === undefined ? undefined : required(input.name, 'name'), baseUrl: input.baseUrl === undefined ? undefined : url(input.baseUrl), apiKey: input.apiKey === undefined ? undefined : required(input.apiKey, 'apiKey'), defaultModel: input.defaultModel === undefined ? undefined : (typeof input.defaultModel === 'string' ? input.defaultModel.trim() || null : null), customHeaders: input.customHeaders === undefined ? undefined : headers(input.customHeaders), enabled: input.enabled === undefined ? undefined : Boolean(input.enabled) };
      try { return { connection: runtimeConnectionsDb.update(id, patch) }; } catch { throw new AppError('Runtime connection not found', { code: 'RUNTIME_CONNECTION_NOT_FOUND', statusCode: 404 }); }
    },
    async test(id: string) {
      const listed = runtimeConnectionsDb.list().find((entry) => entry.id === id);
      if (!listed) throw new AppError('Runtime connection not found', { code: 'RUNTIME_CONNECTION_NOT_FOUND', statusCode: 404 });
      const connection = runtimeConnectionsDb.get(id);
      if (!connection) {
        runtimeConnectionsDb.recordHealth(id, { status: 'credential_error', code: null, message: 'Stored credential could not be decrypted', latencyMs: 0 });
        return { available: false, status: null, connectionId: id, healthStatus: 'credential_error', message: 'Stored credential could not be decrypted', latencyMs: 0 };
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      const startedAt = Date.now();
      const record = (health: { status: 'available' | 'auth_failed' | 'rate_limited' | 'unreachable' | 'server_error'; code: number | null; message: string }) => {
        const latencyMs = Date.now() - startedAt;
        runtimeConnectionsDb.recordHealth(id, { ...health, latencyMs });
        return { available: health.status === 'available', status: health.code, connectionId: connection.id, healthStatus: health.status, message: health.message, latencyMs };
      };
      try {
        const response = await fetch(`${connection.baseUrl}/v1/models`, {
          method: 'GET',
          headers: { 'x-api-key': connection.apiKey, authorization: `Bearer ${connection.apiKey}`, 'anthropic-version': '2023-06-01', ...connection.customHeaders },
          signal: controller.signal,
        });
        if (response.ok) return record({ status: 'available', code: response.status, message: 'OK' });
        if (response.status === 401 || response.status === 403) return record({ status: 'auth_failed', code: response.status, message: 'Authentication failed' });
        if (response.status === 429) return record({ status: 'rate_limited', code: response.status, message: 'Rate limited' });
        if (response.status >= 500) return record({ status: 'server_error', code: response.status, message: 'Upstream server error' });
        return record({ status: 'unreachable', code: response.status, message: 'Health endpoint rejected the request' });
      } catch (error) {
        const timeoutError = error instanceof Error && error.name === 'AbortError';
        return record({ status: 'unreachable', code: null, message: timeoutError ? 'Request timed out' : 'Connection failed' });
      } finally {
        clearTimeout(timeout);
      }
    },
    remove(id: string) {
      if (dependencies.isConnectionInUse?.(id)) throw new AppError('Runtime connection is used by an active task.', { code: 'RUNTIME_CONNECTION_IN_USE', statusCode: 409 });
      if (!runtimeConnectionsDb.remove(id)) throw new AppError('Runtime connection not found', { code: 'RUNTIME_CONNECTION_NOT_FOUND', statusCode: 404 });
      return { success: true };
    },
  };
}
