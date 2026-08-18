import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import spawn from 'cross-spawn';

import type { IProviderAuth } from '@/shared/interfaces.js';
import type { ProviderAuthStatus } from '@/shared/types.js';
import { readObjectRecord, readOptionalString } from '@/shared/utils.js';

type OpenCodeCredentialsStatus = {
  authenticated: boolean;
  email: string | null;
  method: string | null;
  error?: string;
};

const OPENCODE_ENV_CREDENTIAL_KEYS = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY',
  'GROQ_API_KEY',
  'OPENROUTER_API_KEY',
];

export class OpenCodeProviderAuth implements IProviderAuth {
  /**
   * Checks whether the OpenCode CLI is available to the server process.
   */
  private checkInstalled(): boolean {
    try {
      const result = spawn.sync('opencode', ['--version'], { stdio: 'ignore', timeout: 5000, windowsHide: true });
      return !result.error && result.status === 0;
    } catch {
      return false;
    }
  }

  /**
   * Returns OpenCode CLI installation and credential status.
   */
  async getStatus(): Promise<ProviderAuthStatus> {
    const installed = this.checkInstalled();
    const credentials = await this.checkCredentials();

    return {
      installed,
      provider: 'opencode',
      authenticated: credentials.authenticated,
      email: credentials.email,
      method: credentials.method,
      error: credentials.authenticated ? undefined : credentials.error || 'Not authenticated',
    };
  }

  /**
   * Reads OpenCode's auth store, environment keys, or the provider apiKey
   * entries in the OpenCode config file (`~/.config/opencode/opencode.json`).
   */
  private async checkCredentials(): Promise<OpenCodeCredentialsStatus> {
    try {
      const authPath = path.join(os.homedir(), '.local', 'share', 'opencode', 'auth.json');
      const content = await readFile(authPath, 'utf8');
      const auth = readObjectRecord(JSON.parse(content)) ?? {};

      for (const [providerId, providerAuth] of Object.entries(auth)) {
        const providerRecord = readObjectRecord(providerAuth);
        if (!providerRecord) {
          continue;
        }

        const hasCredential = Object.values(providerRecord).some(
          (value) => readOptionalString(value) !== undefined || Boolean(readObjectRecord(value)),
        );
        if (hasCredential) {
          return {
            authenticated: true,
            email: `${providerId} credentials`,
            method: 'credentials_file',
          };
        }
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        return {
          authenticated: false,
          email: null,
          method: null,
          error: error instanceof Error ? error.message : 'Failed to read OpenCode auth',
        };
      }
    }

    const configCredential = await this.readConfigCredential();
    if (configCredential) {
      return {
        authenticated: true,
        email: configCredential,
        method: 'config_file',
      };
    }

    const envCredential = OPENCODE_ENV_CREDENTIAL_KEYS.find((key) => process.env[key]?.trim());
    if (envCredential) {
      return {
        authenticated: true,
        email: envCredential,
        method: 'environment',
      };
    }

    return {
      authenticated: false,
      email: null,
      method: null,
      error: 'OpenCode not configured',
    };
  }

  /**
   * Detects provider apiKey entries declared directly in the OpenCode config
   * file, which is how providers configured via `opencode.json` authenticate
   * (they do not surface in `auth.json`).
   */
  private async readConfigCredential(): Promise<string | null> {
    for (const configPath of [
      path.join(os.homedir(), '.config', 'opencode', 'opencode.json'),
      path.join(os.homedir(), '.config', 'opencode', 'opencode.jsonc'),
    ]) {
      try {
        const content = await readFile(configPath, 'utf8');
        const config = readObjectRecord(JSON.parse(content)) ?? {};
        const providers = readObjectRecord(config.provider);
        if (!providers) {
          continue;
        }
        for (const [providerId, providerConfig] of Object.entries(providers)) {
          const providerRecord = readObjectRecord(providerConfig);
          const options = readObjectRecord(providerRecord?.options);
          if (readOptionalString(options?.apiKey)) {
            return `${providerId} apiKey`;
          }
        }
      } catch {
        // Missing or malformed config files are simply not a credential source.
      }
    }
    return null;
  }
}
