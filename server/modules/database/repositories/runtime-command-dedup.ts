import { getConnection } from '@/modules/database/connection.js';
import type {
  RuntimeAcceptedResponse,
  RuntimeCommandDedupRecord,
} from '@/shared/types.js';

type AcceptRuntimeCommandInput = {
  idempotencyKey: string;
  commandType: RuntimeCommandDedupRecord['commandType'];
  requestHash: string;
  response: RuntimeAcceptedResponse | Record<string, unknown>;
};

type AcceptRuntimeCommandResult =
  | { outcome: 'created'; response: Record<string, unknown> }
  | { outcome: 'replay'; response: Record<string, unknown> }
  | { outcome: 'conflict'; response: Record<string, unknown> };

type InspectRuntimeCommandResult =
  | { outcome: 'missing'; response: null }
  | { outcome: 'replay'; response: Record<string, unknown> }
  | { outcome: 'conflict'; response: Record<string, unknown> };

function toRecord(row: {
  idempotency_key: string;
  command_type: RuntimeCommandDedupRecord['commandType'];
  request_hash: string;
  response_json: string;
  created_at: string;
}): RuntimeCommandDedupRecord {
  return {
    idempotencyKey: row.idempotency_key,
    commandType: row.command_type,
    requestHash: row.request_hash,
    responseJson: row.response_json,
    createdAt: row.created_at,
  };
}

/**
 * Persistent Runtime command deduplication repository consumed by the Runtime module.
 *
 * `accept` atomically claims a previously unseen idempotency key. Matching retries
 * replay the stored response, while reuse of the key for a different semantic
 * request is reported as a conflict and never executes the command again.
 */
export const runtimeCommandDedupDb = {
  inspect(input: Omit<AcceptRuntimeCommandInput, 'response'>): InspectRuntimeCommandResult {
    const row = getConnection().prepare(`
      SELECT idempotency_key, command_type, request_hash, response_json, created_at
      FROM runtime_command_dedup
      WHERE idempotency_key = ?
    `).get(input.idempotencyKey) as {
      idempotency_key: string;
      command_type: RuntimeCommandDedupRecord['commandType'];
      request_hash: string;
      response_json: string;
      created_at: string;
    } | undefined;
    if (!row) {
      return { outcome: 'missing', response: null };
    }
    const existing = toRecord(row);
    const response = JSON.parse(existing.responseJson) as Record<string, unknown>;
    if (existing.commandType !== input.commandType || existing.requestHash !== input.requestHash) {
      return { outcome: 'conflict', response };
    }
    return { outcome: 'replay', response };
  },

  updateResponse(idempotencyKey: string, response: Record<string, unknown>): void {
    getConnection().prepare(`
      UPDATE runtime_command_dedup
      SET response_json = ?
      WHERE idempotency_key = ?
    `).run(JSON.stringify(response), idempotencyKey);
  },

  accept(input: AcceptRuntimeCommandInput): AcceptRuntimeCommandResult {
    const db = getConnection();
    const responseJson = JSON.stringify(input.response);

    const result = db.prepare(`
      INSERT INTO runtime_command_dedup (
        idempotency_key,
        command_type,
        request_hash,
        response_json
      ) VALUES (?, ?, ?, ?)
      ON CONFLICT(idempotency_key) DO NOTHING
    `).run(input.idempotencyKey, input.commandType, input.requestHash, responseJson);

    if (result.changes === 1) {
      return { outcome: 'created', response: JSON.parse(responseJson) as Record<string, unknown> };
    }

    const existingRow = db.prepare(`
      SELECT idempotency_key, command_type, request_hash, response_json, created_at
      FROM runtime_command_dedup
      WHERE idempotency_key = ?
    `).get(input.idempotencyKey) as {
      idempotency_key: string;
      command_type: RuntimeCommandDedupRecord['commandType'];
      request_hash: string;
      response_json: string;
      created_at: string;
    };
    const existing = toRecord(existingRow);
    const storedResponse = JSON.parse(existing.responseJson) as Record<string, unknown>;

    if (existing.commandType !== input.commandType || existing.requestHash !== input.requestHash) {
      return { outcome: 'conflict', response: storedResponse };
    }

    return { outcome: 'replay', response: storedResponse };
  },
};
