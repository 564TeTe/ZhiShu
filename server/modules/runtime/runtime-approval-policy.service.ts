import fs from 'node:fs';
import path from 'node:path';

import type { RuntimePermissionPolicy } from '@/shared/types.js';

export type RuntimeApprovalEvaluation = {
  outcome: 'AUTO_APPROVE' | 'MANUAL' | 'DENY';
  rule: string;
  reason: string;
};

const READ_TOOLS = new Set(['read', 'readfile', 'glob', 'grep', 'search', 'searchcode', 'list', 'listdirectory']);
const CREDENTIALS = new Set([
  '.env', '.npmrc', '.pypirc', 'id_rsa', 'id_ed25519', 'credentials', 'credentials.json',
  'service-account.json', 'token', 'token.json',
]);
const SAFE_COMMANDS = [
  ['npm', 'test'], ['npm', 'run', 'test'], ['npm', 'run', 'lint'], ['npm', 'run', 'build'],
  ['pnpm', 'test'], ['pnpm', 'lint'], ['pnpm', 'build'], ['yarn', 'test'], ['yarn', 'lint'],
  ['yarn', 'build'], ['mvn', 'test'], ['mvn', 'package'], ['./mvnw', 'test'],
  ['./mvnw', 'package'], ['gradle', 'test'], ['gradle', 'build'], ['./gradlew', 'test'],
  ['./gradlew', 'build'], ['git', 'diff'], ['git', 'status'], ['git', 'log'],
];

function result(outcome: RuntimeApprovalEvaluation['outcome'], rule: string, reason: string) {
  return { outcome, rule, reason } satisfies RuntimeApprovalEvaluation;
}

function flattenStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(flattenStrings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(flattenStrings);
  return [];
}

function realOrNormalized(candidate: string): string {
  const absolute = path.resolve(candidate);
  let existing = absolute;
  const missing: string[] = [];
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) return absolute;
    missing.unshift(path.basename(existing));
    existing = parent;
  }
  return path.resolve(fs.realpathSync.native(existing), ...missing);
}

function isInside(candidate: string, parent: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function mentionsCredential(value: string): boolean {
  const normalized = value.replaceAll('\\', '/').toLowerCase();
  return normalized.split('/').some(segment => CREDENTIALS.has(segment) || segment.startsWith('.env.'))
    || normalized.includes('/.ssh/') || normalized.includes('/.aws/') || normalized.includes('private_key');
}

function tokenize(command: string): string[] {
  const tokens: string[] = [];
  let token = '';
  let quote = '';
  for (const current of command) {
    if (current === '"' || current === "'") {
      if (!quote) quote = current;
      else if (quote === current) quote = '';
      else token += current;
    } else if (/\s/.test(current) && !quote) {
      if (token) tokens.push(token);
      token = '';
    } else token += current;
  }
  if (quote) return ['__INVALID_QUOTE__'];
  if (token) tokens.push(token);
  return tokens;
}

function readCommand(input: Record<string, unknown>): string[] {
  if (Array.isArray(input.argv)) return input.argv.map(String).map(value => value.trim()).filter(Boolean);
  const command = typeof input.command === 'string' ? input.command : typeof input.cmd === 'string' ? input.cmd : '';
  return command.trim() ? tokenize(command.trim()) : [];
}

function exactMatch(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isDestructive(command: string[]): boolean {
  const executable = command[0]?.toLowerCase() ?? '';
  const joined = command.join(' ').toLowerCase();
  return new Set(['rm', 'rmdir', 'del', 'erase', 'remove-item', 'format', 'diskpart', 'reg', 'shutdown']).has(executable)
    || joined.startsWith('git clean') || joined.startsWith('git reset --hard')
    || joined.includes('drop database') || joined.includes('truncate table');
}

function looksLikePath(value: string): boolean {
  if (!value || value.startsWith('-') || /^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return false;
  return value.startsWith('../') || value.startsWith('..\\') || path.isAbsolute(value)
    || value.includes('/') || value.includes('\\');
}

function isNetworkUpload(command: string[]): boolean {
  const executable = command[0]?.toLowerCase() ?? '';
  const joined = command.join(' ').toLowerCase();
  return new Set([
    'scp', 'sftp', 'ftp', 'rsync', 'nc', 'netcat', 'curl', 'wget',
    'invoke-webrequest', 'invoke-restmethod',
  ]).has(executable)
    || joined.startsWith('git push') || joined.startsWith('npm publish')
    || joined.startsWith('pnpm publish') || joined.startsWith('yarn publish')
    || joined.startsWith('docker push') || joined.startsWith('twine upload')
    || joined.startsWith('aws s3 ') || joined.startsWith('az storage ')
    || joined.startsWith('gcloud storage ') || joined.startsWith('gh release upload')
    || joined.includes(' deploy') || joined.includes(' publish');
}

/** Runtime service uses this evaluator as the final defense before releasing a paused provider tool. */
export function evaluateRuntimeApproval(
  policy: RuntimePermissionPolicy,
  toolName: string,
  rawInput: unknown,
): RuntimeApprovalEvaluation {
  const input = rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput)
    ? rawInput as Record<string, unknown>
    : {};
  let root: string;
  try {
    root = realOrNormalized(policy.projectRoot);
  } catch {
    return result('DENY', 'invalid-project-root', 'Project root cannot be resolved safely');
  }
  if (flattenStrings(input).some(mentionsCredential)) {
    return result('DENY', 'credential-file', 'Credential files are never permitted');
  }
  for (const [key, value] of Object.entries(input)) {
    if (!key.toLowerCase().match(/path|file|cwd|directory/)) continue;
    for (const rawPath of flattenStrings(value)) {
      try {
        const candidate = realOrNormalized(path.isAbsolute(rawPath) ? rawPath : path.resolve(root, rawPath));
        if (!isInside(candidate, root)) return result('DENY', 'outside-project', 'Path resolves outside the project root');
        const allowed = policy.allowedDirectories.some(directory => {
          if (path.isAbsolute(directory)) return false;
          return isInside(candidate, realOrNormalized(path.resolve(root, directory)));
        });
        if (!allowed) return result('DENY', 'outside-allowed-directory', 'Path is outside the configured project directories');
      } catch {
        return result('DENY', 'invalid-path', 'Path cannot be resolved safely');
      }
    }
  }
  const command = readCommand(input);
  const commandText = command.join(' ');
  if (/[|;&<>`\r\n]|\$\(/.test(commandText)) {
    return result('DENY', 'shell-metacharacter', 'Shell composition is not eligible for approval');
  }
  for (const token of command.slice(1)) {
    const pathToken = token.includes('=') ? token.slice(token.indexOf('=') + 1) : token;
    if (!looksLikePath(pathToken)) continue;
    try {
      const candidate = realOrNormalized(path.isAbsolute(pathToken) ? pathToken : path.resolve(root, pathToken));
      if (!isInside(candidate, root)) return result('DENY', 'outside-project', 'Command path resolves outside the project root');
      const allowed = policy.allowedDirectories.some(directory => !path.isAbsolute(directory)
        && isInside(candidate, realOrNormalized(path.resolve(root, directory))));
      if (!allowed) return result('DENY', 'outside-allowed-directory', 'Command path is outside the configured project directories');
    } catch {
      return result('DENY', 'invalid-path', 'Command path cannot be resolved safely');
    }
  }
  if (command.length && isDestructive(command)) return result('DENY', 'dangerous-delete', 'Destructive or system-level commands are forbidden');
  if (command.length && isNetworkUpload(command)) return result('DENY', 'network-upload', 'Network upload or publishing commands are forbidden');
  if (policy.mode === 'MANUAL') return result('MANUAL', 'manual-mode', 'Project policy requires a user decision');

  const normalizedTool = toolName.replace(/[^A-Za-z]/g, '').toLowerCase();
  if (READ_TOOLS.has(normalizedTool)) return result('AUTO_APPROVE', 'safe-read-search', 'Read/search operation is inside an allowed project directory');
  if (SAFE_COMMANDS.some(safe => exactMatch(safe, command))) return result('AUTO_APPROVE', 'safe-command', 'Command exactly matched a built-in test, lint, build, or read rule');
  if (policy.mode === 'AUTO_TRUSTED' && policy.trustedCommands.some(safe => exactMatch(safe, command))) {
    return result('AUTO_APPROVE', 'trusted-command', 'Command exactly matched the project trusted command allowlist');
  }
  return result('MANUAL', 'no-auto-rule', 'No automatic approval rule matched this operation');
}
