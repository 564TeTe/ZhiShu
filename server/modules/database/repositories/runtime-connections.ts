import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { getConnection } from '@/modules/database/connection.js';

export type RuntimeConnection = {
  id: string;
  name: string;
  executor: 'claude';
  protocol: 'anthropic';
  baseUrl: string;
  defaultModel: string | null;
  customHeaders: Record<string, string>;
  enabled: boolean;
  credentialConfigured: boolean;
  credentialHint: string | null;
  lastHealthStatus: 'available' | 'auth_failed' | 'rate_limited' | 'unreachable' | 'server_error' | 'not_checked' | 'credential_error';
  lastHealthCode: number | null;
  lastHealthMessage: string | null;
  lastCheckedAt: string | null;
  lastLatencyMs: number | null;
};

type RuntimeConnectionSecret = RuntimeConnection & { apiKey: string };

const KEY_LENGTH = 32;

function encryptionKey(): Buffer {
  const configured = process.env.ZHISHU_CONNECTION_ENCRYPTION_KEY?.trim();
  if (configured) {
    return crypto.createHash('sha256').update(configured).digest();
  }
  const keyPath = path.join(os.homedir(), '.cloudcli', 'runtime-connections.key');
  try {
    const existing = fs.readFileSync(keyPath);
    if (existing.length === KEY_LENGTH) return existing;
  } catch { /* create it below */ }
  const key = crypto.randomBytes(KEY_LENGTH);
  fs.mkdirSync(path.dirname(keyPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(keyPath, key, { mode: 0o600 });
  return key;
}

function encrypt(value: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
}

function decrypt(value: string): string {
  const [ivText, tagText, ciphertextText] = value.split('.');
  if (!ivText || !tagText || !ciphertextText) throw new Error('Invalid encrypted connection credential');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextText, 'base64url')), decipher.final()]).toString('utf8');
}

function parseHeaders(value: string): Record<string, string> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([key, entry]) => typeof key === 'string' && typeof entry === 'string'));
  } catch {
    return {};
  }
}

function toPublic(row: Record<string, unknown>): RuntimeConnection {
  const encrypted = String(row.encrypted_api_key ?? '');
  let hint: string | null = null;
  try {
    const apiKey = decrypt(encrypted);
    hint = apiKey ? `****${apiKey.slice(-4)}` : null;
  } catch { /* old or invalid credentials are reported as unavailable */ }
  return {
    id: String(row.id), name: String(row.name), executor: 'claude', protocol: 'anthropic',
    baseUrl: String(row.base_url), defaultModel: row.default_model ? String(row.default_model) : null,
    customHeaders: parseHeaders(String(row.custom_headers_json ?? '{}')),
    enabled: row.enabled === 1 || row.enabled === true || row.enabled === '1', credentialConfigured: Boolean(encrypted), credentialHint: hint,
    lastHealthStatus: (row.last_health_status ? String(row.last_health_status) : 'not_checked') as RuntimeConnection['lastHealthStatus'],
    lastHealthCode: row.last_health_code == null ? null : Number(row.last_health_code),
    lastHealthMessage: row.last_health_message == null ? null : String(row.last_health_message),
    lastCheckedAt: row.last_checked_at == null ? null : String(row.last_checked_at),
    lastLatencyMs: row.last_latency_ms == null ? null : Number(row.last_latency_ms),
  };
}

export const runtimeConnectionsDb = {
  list(): RuntimeConnection[] {
    const rows = getConnection().prepare('SELECT * FROM runtime_connections ORDER BY name').all() as Record<string, unknown>[];
    return rows.map(toPublic);
  },
  get(id: string): RuntimeConnectionSecret | null {
    const row = getConnection().prepare('SELECT * FROM runtime_connections WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    try {
      return { ...toPublic(row), apiKey: decrypt(String(row.encrypted_api_key)) };
    } catch {
      return null;
    }
  },
  create(input: { id: string; name: string; baseUrl: string; apiKey: string; defaultModel?: string | null; customHeaders?: Record<string, string> }): RuntimeConnection {
    const db = getConnection();
    db.prepare(`INSERT INTO runtime_connections (id, name, base_url, encrypted_api_key, default_model, custom_headers_json) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(input.id, input.name, input.baseUrl, encrypt(input.apiKey), input.defaultModel ?? null, JSON.stringify(input.customHeaders ?? {}));
    return this.list().find((entry) => entry.id === input.id)!;
  },
  update(id: string, input: { name?: string; baseUrl?: string; apiKey?: string; defaultModel?: string | null; customHeaders?: Record<string, string>; enabled?: boolean }): RuntimeConnection {
    const existing = this.get(id);
    if (!existing) throw new Error('Runtime connection not found');
    const db = getConnection();
    db.prepare(`UPDATE runtime_connections SET name = ?, base_url = ?, encrypted_api_key = ?, default_model = ?, custom_headers_json = ?, enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(input.name ?? existing.name, input.baseUrl ?? existing.baseUrl, input.apiKey ? encrypt(input.apiKey) : encrypt(existing.apiKey), input.defaultModel === undefined ? existing.defaultModel : input.defaultModel, JSON.stringify(input.customHeaders ?? existing.customHeaders), input.enabled === undefined ? (existing.enabled ? 1 : 0) : (input.enabled ? 1 : 0), id);
    return this.list().find((entry) => entry.id === id)!;
  },
  recordHealth(id: string, health: { status: RuntimeConnection['lastHealthStatus']; code: number | null; message: string; latencyMs: number | null }): void {
    getConnection().prepare(`UPDATE runtime_connections SET last_health_status = ?, last_health_code = ?, last_health_message = ?, last_checked_at = CURRENT_TIMESTAMP, last_latency_ms = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(health.status, health.code, health.message, health.latencyMs, id);
  },
  remove(id: string): boolean {
    return getConnection().prepare('DELETE FROM runtime_connections WHERE id = ?').run(id).changes > 0;
  },
};
