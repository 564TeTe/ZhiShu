import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));

export const projectRoot = resolve(scriptDirectory, '..', '..');
export const demoRoot = join(projectRoot, '.zhishu-demo');
export const statePath = join(demoRoot, 'stack-state.json');
export const demoRepositoryPath = join(projectRoot, 'demo-repository');
export const taskTemplatePath = join(demoRepositoryPath, 'tasks.json');
export const controlPlanePath = join(projectRoot, 'control-plane');
export const composePath = join(controlPlanePath, 'compose.yml');

export function parseArguments(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--')) {
      throw new Error(`Unsupported positional argument: ${argument}`);
    }
    const [rawKey, inlineValue] = argument.slice(2).split('=', 2);
    const key = rawKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (inlineValue !== undefined) {
      parsed[key] = inlineValue;
    } else if (argv[index + 1] && !argv[index + 1].startsWith('--')) {
      parsed[key] = argv[index + 1];
      index += 1;
    } else {
      parsed[key] = true;
    }
  }
  return parsed;
}

export function isZhishuNodeHealth(body) {
  return body?.status === 'ok'
    && body?.runtimeEventDelivery?.configurationReady === true
    && body?.runtimeEventDelivery?.started === true;
}

export function readDotEnv(path) {
  if (!existsSync(path)) return {};
  return readFileSync(path, 'utf8').split(/\r?\n/).reduce((values, line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return values;
    const separator = trimmed.indexOf('=');
    if (separator < 1) return values;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
    return values;
  }, {});
}

export function resolveSharedToken(
  environment = process.env,
  fileEnvironment = readDotEnv(join(projectRoot, '.env')),
) {
  const configured = environment.ZS_RUNTIME_TOKEN?.trim() || fileEnvironment.ZS_RUNTIME_TOKEN?.trim();
  return configured || randomBytes(32).toString('hex');
}

export function resolveProjectControlToken(
  environment = process.env,
  fileEnvironment = readDotEnv(join(projectRoot, '.env')),
) {
  const configured = environment.ZS_PROJECT_CONTROL_TOKEN?.trim()
    || fileEnvironment.ZS_PROJECT_CONTROL_TOKEN?.trim();
  return configured || randomBytes(32).toString('hex');
}

export function commandResult(command, args = [], options = {}) {
  let executable = command;
  let windowsCommandShim = false;
  if (process.platform === 'win32' && !command.includes('.')) {
    const lookup = spawnSync('where.exe', [command], { encoding: 'utf8', windowsHide: true });
    const candidates = lookup.status === 0 ? lookup.stdout.split(/\r?\n/).filter(Boolean) : [];
    const nativeExecutable = candidates.find((candidate) => candidate.toLowerCase().endsWith('.exe'));
    const commandShim = candidates.find((candidate) => /\.(?:cmd|bat)$/i.test(candidate));
    executable = nativeExecutable ?? (commandShim ? `${command}.cmd` : command);
    windowsCommandShim = Boolean(!nativeExecutable && commandShim);
  }
  return spawnSync(executable, args, {
    cwd: options.cwd ?? projectRoot,
    env: options.env ?? process.env,
    encoding: 'utf8',
    windowsHide: true,
    shell: windowsCommandShim,
    timeout: options.timeout ?? 15_000,
  });
}

export function commandAvailable(command, args = ['--version']) {
  const result = commandResult(command, args);
  return !result.error && result.status === 0;
}

export function findDockerDesktopExecutable(environment = process.env, fileExists = existsSync) {
  if (process.platform !== 'win32') return null;
  const candidates = [
    environment.ProgramFiles && join(environment.ProgramFiles, 'Docker', 'Docker', 'Docker Desktop.exe'),
    environment.LOCALAPPDATA && join(environment.LOCALAPPDATA, 'Docker', 'Docker Desktop.exe'),
  ].filter(Boolean);
  return candidates.find((candidate) => fileExists(candidate)) ?? null;
}

export function isDockerDaemonRunning() {
  const result = commandResult('docker', ['info'], { timeout: 15_000 });
  return !result.error && result.status === 0;
}

export async function ensureDockerDaemon(options = {}) {
  if (isDockerDaemonRunning()) {
    return { startedDockerDesktop: false };
  }

  if (process.platform !== 'win32') {
    throw new Error('Docker daemon 未运行，请启动 Docker 后重试。');
  }

  const executable = findDockerDesktopExecutable();
  if (!executable) {
    throw new Error('Docker daemon 未运行，且未找到 Docker Desktop。请先安装或手动启动 Docker Desktop。');
  }

  console.log('[DOCKER] Docker daemon 未运行，正在启动 Docker Desktop……');
  const child = spawn(executable, [], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();

  const timeoutMs = options.timeoutMs ?? 120_000;
  const intervalMs = options.intervalMs ?? 2_000;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isDockerDaemonRunning()) {
      console.log('[DOCKER] Docker Desktop 已就绪。');
      return { startedDockerDesktop: true };
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, intervalMs));
  }

  throw new Error(`等待 Docker Desktop 超时（${Math.round(timeoutMs / 1000)} 秒）。请查看 Docker Desktop 状态后重试。`);
}

function javaExecutable(javaHome) {
  return join(javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
}

function javaMajorVersion(executable) {
  if (!existsSync(executable)) return null;
  const result = commandResult(executable, ['-version']);
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  const match = output.match(/version\s+"(?:1\.)?(\d+)/i);
  return match ? Number.parseInt(match[1], 10) : null;
}

function childDirectories(path) {
  if (!existsSync(path)) return [];
  try {
    return readdirSync(path)
      .map((name) => join(path, name))
      .filter((candidate) => statSync(candidate).isDirectory());
  } catch {
    return [];
  }
}

export function findJava21(environment = process.env) {
  const candidates = [];
  if (environment.JAVA_HOME) candidates.push(environment.JAVA_HOME);
  if (process.platform === 'win32') {
    candidates.push(...childDirectories('C:\\Program Files\\Java'));
    candidates.push(...childDirectories('C:\\Program Files\\Eclipse Adoptium'));
    candidates.push(...childDirectories('C:\\Program Files\\Microsoft'));
  } else {
    candidates.push(...childDirectories('/usr/lib/jvm'));
  }

  const uniqueCandidates = [...new Set(candidates.map((candidate) => resolve(candidate)))];
  for (const javaHome of uniqueCandidates) {
    const executable = javaExecutable(javaHome);
    if (javaMajorVersion(executable) === 21) {
      return { javaHome, executable };
    }
  }

  const pathResult = commandResult('java', ['-version']);
  const pathOutput = `${pathResult.stdout ?? ''}\n${pathResult.stderr ?? ''}`;
  const match = pathOutput.match(/version\s+"(?:1\.)?(\d+)/i);
  if (match && Number.parseInt(match[1], 10) === 21) {
    return { javaHome: environment.JAVA_HOME ?? null, executable: 'java' };
  }
  return null;
}

export function runPreflight() {
  const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);
  const java = findJava21();
  const fileEnvironment = readDotEnv(join(projectRoot, '.env'));
  const configuredRuntimeToken = process.env.ZS_RUNTIME_TOKEN?.trim()
    || fileEnvironment.ZS_RUNTIME_TOKEN?.trim()
    || '';
  const configuredProjectControlToken = process.env.ZS_PROJECT_CONTROL_TOKEN?.trim()
    || fileEnvironment.ZS_PROJECT_CONTROL_TOKEN?.trim()
    || '';
  const checks = [
    { name: 'Node.js 22+', ok: nodeMajor >= 22, detail: process.version },
    { name: 'npm', ok: commandAvailable('npm'), detail: 'required for builds and fixture tests' },
    { name: 'JDK 21', ok: Boolean(java), detail: java?.javaHome ?? 'not found' },
    { name: 'Maven 3.9+', ok: commandAvailable('mvn'), detail: 'required to build Control Plane' },
    { name: 'Docker CLI', ok: commandAvailable('docker'), detail: 'required for PostgreSQL' },
    { name: 'Docker daemon', ok: commandAvailable('docker', ['info']), detail: 'must be running' },
    { name: 'Docker Compose', ok: commandAvailable('docker', ['compose', 'version']), detail: 'required for PostgreSQL' },
    { name: 'Claude Code CLI', ok: commandAvailable('claude'), detail: 'required for real Agent tasks' },
    { name: 'Node dependencies', ok: existsSync(join(projectRoot, 'node_modules')), detail: 'run npm install when absent' },
    { name: 'Demo fixture', ok: existsSync(taskTemplatePath), detail: taskTemplatePath },
    {
      name: 'Shared Runtime token',
      ok: true,
      detail: configuredRuntimeToken
        ? 'configured; value not displayed'
        : 'an ephemeral token will be generated; value will not be displayed',
    },
    {
      name: 'Project Control token',
      ok: !configuredRuntimeToken || !configuredProjectControlToken
        || configuredRuntimeToken !== configuredProjectControlToken,
      detail: configuredProjectControlToken
        ? 'configured separately; value not displayed'
        : 'an independent ephemeral token will be generated; value will not be displayed',
    },
  ];
  return { ok: checks.every((check) => check.ok), checks, java };
}

export function loadTaskTemplates() {
  const document = JSON.parse(readFileSync(taskTemplatePath, 'utf8'));
  if (document.schemaVersion !== 1 || !Array.isArray(document.tasks) || document.tasks.length !== 4) {
    throw new Error('demo-repository/tasks.json must contain exactly four schemaVersion 1 tasks.');
  }
  return document.tasks;
}

export async function ensureDemoDirectories() {
  await mkdir(join(demoRoot, 'logs'), { recursive: true });
  await mkdir(join(demoRoot, 'workspaces'), { recursive: true });
  await mkdir(join(demoRoot, 'evidence'), { recursive: true });
}

export async function readStackState() {
  try {
    return JSON.parse(await readFile(statePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

export async function writeStackState(state) {
  await ensureDemoDirectories();
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

export function createProjectRegistration(workspacePath) {
  return {
    candidateProjectId: randomUUID(),
    projectRef: resolve(workspacePath),
    displayName: `知枢固定 Demo ${new Date().toISOString()}`,
  };
}

export async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
  try {
    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(options.headers ?? {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
    const text = await response.text();
    let body = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    if (!response.ok) {
      throw new Error(`${options.method ?? 'GET'} ${url} returned ${response.status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

export async function waitForJson(url, predicate, options = {}) {
  const timeoutMs = options.timeoutMs ?? 90_000;
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const body = await fetchJson(url, {
        headers: options.headers,
        timeoutMs: Math.min(5_000, timeoutMs),
      });
      if (predicate(body)) return body;
      lastError = new Error(`Health response was not ready: ${JSON.stringify(body)}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, options.intervalMs ?? 1_000));
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError?.message ?? 'no response'}`);
}

export function timestampLabel(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

export function isProcessRunning(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function getProcessCommandLine(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (process.platform === 'win32') {
    const result = commandResult('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `(Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}').CommandLine`,
    ]);
    return result.status === 0 && result.stdout.trim() ? result.stdout.trim() : null;
  }
  if (process.platform === 'linux') {
    try {
      return readFileSync(`/proc/${pid}/cmdline`, 'utf8').replaceAll('\0', ' ').trim() || null;
    } catch {
      return null;
    }
  }
  const result = commandResult('ps', ['-p', String(pid), '-o', 'command=']);
  return result.status === 0 && result.stdout.trim() ? result.stdout.trim() : null;
}

export function processCommandMatches(commandLine, expectedPath) {
  if (!commandLine || !expectedPath) return false;
  const normalize = (value) => value.replaceAll('\\', '/').toLowerCase();
  return normalize(commandLine).includes(normalize(expectedPath));
}

export function openBrowser(url) {
  const command = process.platform === 'win32'
    ? { executable: 'cmd.exe', args: ['/c', 'start', '', url] }
    : process.platform === 'darwin'
      ? { executable: 'open', args: [url] }
      : { executable: 'xdg-open', args: [url] };
  const child = spawnSync(command.executable, command.args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 10_000,
  });
  return !child.error && child.status === 0;
}
