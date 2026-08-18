#!/usr/bin/env node
import { closeSync, existsSync, openSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

import {
  commandResult,
  composePath,
  controlPlanePath,
  demoRoot,
  ensureDockerDaemon,
  ensureDemoDirectories,
  fetchJson,
  getProcessCommandLine,
  isProcessRunning,
  isZhishuNodeHealth,
  openBrowser,
  parseArguments,
  processCommandMatches,
  projectRoot,
  readStackState,
  resolveProjectControlToken,
  resolveSharedToken,
  runPreflight,
  statePath,
  timestampLabel,
  waitForJson,
  writeStackState,
} from './lib.mjs';

function assertCommand(result, label) {
  if (result.error || result.status !== 0) {
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
    throw new Error(`${label} failed${output ? `:\n${output}` : '.'}`);
  }
}

async function assertProjectControlCapability(controlBaseUrl, projectControlToken) {
  const response = await fetch(
    `${controlBaseUrl}/internal/project-control/v1/projects/00000000-0000-0000-0000-000000000000/activity?limit=1`,
    { headers: { Authorization: `Bearer ${projectControlToken}`, Accept: 'application/json' } },
  );
  const body = await response.json().catch(() => null);
  if (response.status !== 404 || body?.code !== 'TASK_NOT_FOUND') {
    throw new Error(`Project Control activity capability is unavailable: ${response.status} ${JSON.stringify(body)}`);
  }
}

function launchProcess(executable, args, options) {
  const stdout = openSync(options.stdoutPath, 'a');
  const stderr = openSync(options.stderrPath, 'a');
  try {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env,
      detached: true,
      stdio: ['ignore', stdout, stderr],
      windowsHide: true,
    });
    child.unref();
    return child.pid;
  } finally {
    closeSync(stdout);
    closeSync(stderr);
  }
}

async function main() {
  const arguments_ = parseArguments(process.argv.slice(2));
  const existing = await readStackState();
  if (existing && isProcessRunning(existing.nodePid) && isProcessRunning(existing.controlPid)) {
    const nodeOwned = processCommandMatches(
      getProcessCommandLine(existing.nodePid),
      'dist-server/server/index.js',
    );
    const controlOwned = processCommandMatches(
      getProcessCommandLine(existing.controlPid),
      'control-plane/target/zhishu-control-plane-0.1.0-SNAPSHOT.jar',
    );
    if (!nodeOwned || !controlOwned) {
      throw new Error('状态文件中的 PID 已不属于知枢启动器，拒绝复用。请人工检查 .zhishu-demo/stack-state.json。');
    }
    if (!existing.projectControlToken) {
      throw new Error('现有 Demo 栈早于独立 Project Control Credential。请先停止，再启动以加载 G8 构建。');
    }
    const [nodeHealth, controlHealth, runtimeHealth] = await Promise.all([
      fetchJson(`${existing.nodeBaseUrl}/health`, { timeoutMs: 3_000 }),
      fetchJson(`${existing.controlBaseUrl}/actuator/health`, { timeoutMs: 3_000 }),
      fetchJson(`${existing.nodeBaseUrl}/internal/runtime/v1/health`, {
        timeoutMs: 3_000,
        headers: { Authorization: `Bearer ${existing.sharedToken}` },
      }),
    ]);
    if (!isZhishuNodeHealth(nodeHealth)
      || controlHealth?.status !== 'UP'
      || runtimeHealth?.status !== 'up') {
      throw new Error('状态文件中的服务仍在运行但未通过完整健康检查。请先运行 npm run zhishu:stop，再重新启动。');
    }
    await assertProjectControlCapability(existing.controlBaseUrl, existing.projectControlToken);
    console.log('知枢 Demo 栈已经运行。');
    console.log(`Node: ${existing.nodeBaseUrl}`);
    console.log(`Control Plane: ${existing.controlBaseUrl}`);
    if (arguments_.open && !openBrowser(existing.nodeBaseUrl)) {
      console.warn(`[WARN] 无法自动打开浏览器，请手动访问 ${existing.nodeBaseUrl}`);
    }
    return;
  }
  if (existing && (isProcessRunning(existing.nodePid) || isProcessRunning(existing.controlPid))) {
    throw new Error('发现不完整的旧 Demo 栈。请先运行 npm run demo:stop，再重新启动。');
  }
  if (existing) {
    rmSync(statePath, { force: true });
    console.log('[CLEAN] 已清理失效的旧启动状态。');
  }

  await ensureDockerDaemon();

  const preflight = runPreflight();
  for (const check of preflight.checks) {
    console.log(`${check.ok ? '[PASS]' : '[FAIL]'} ${check.name}`);
  }
  if (!preflight.ok || !preflight.java) {
    throw new Error('环境检查失败，请运行 npm run demo:check 查看详情。');
  }

  await ensureDemoDirectories();
  const nodePort = Number.parseInt(String(arguments_.nodePort ?? '3001'), 10);
  const controlPort = Number.parseInt(String(arguments_.controlPort ?? '8080'), 10);
  if (!Number.isInteger(nodePort) || !Number.isInteger(controlPort)) {
    throw new Error('node-port and control-port must be integers.');
  }

  const nodeBaseUrl = `http://127.0.0.1:${nodePort}`;
  const controlBaseUrl = `http://127.0.0.1:${controlPort}`;
  const requestedServices = [
    {
      name: 'Node',
      url: `${nodeBaseUrl}/health`,
      ready: isZhishuNodeHealth,
    },
    { name: 'Control Plane', url: `${controlBaseUrl}/actuator/health`, ready: (body) => body?.status === 'UP' },
  ];
  const detectedServices = [];
  for (const service of requestedServices) {
    try {
      const health = await fetchJson(service.url, { timeoutMs: 1_000 });
      if (!service.ready(health)) {
        throw new Error(`${service.name} port serves an unhealthy application at ${service.url}.`);
      }
      detectedServices.push(service.name);
    } catch (error) {
      const message = String(error.message);
      if (message.includes('unhealthy application') || / returned \d{3}:/.test(message)) {
        throw new Error(`${service.name} 端口已被其他或未就绪的 HTTP 应用占用：${service.url}`);
      }
    }
  }
  if (detectedServices.length > 0 && detectedServices.length < requestedServices.length) {
    throw new Error(`只检测到部分现有服务（${detectedServices.join(', ')}）。为避免混用不同令牌，请停止旧服务或改用其他端口。`);
  }
  if (detectedServices.length === requestedServices.length) {
    throw new Error('默认地址上已有健康服务但没有受控 Demo 状态文件；为避免混用令牌，请先停止现有服务或改用其他端口。');
  }

  const sharedToken = resolveSharedToken();
  const projectControlToken = resolveProjectControlToken();
  if (projectControlToken === sharedToken) {
    throw new Error('ZS_PROJECT_CONTROL_TOKEN must not reuse ZS_RUNTIME_TOKEN.');
  }
  const javaEnvironment = {
    ...process.env,
    ...(preflight.java.javaHome ? { JAVA_HOME: preflight.java.javaHome } : {}),
    PATH: preflight.java.javaHome
      ? `${join(preflight.java.javaHome, 'bin')}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}`
      : process.env.PATH,
  };

  if (!arguments_.skipBuild) {
    console.log('[BUILD] 构建 Node 客户端与服务端……');
    assertCommand(commandResult('npm', ['run', 'build'], {
      env: {
        ...process.env,
        VITE_ZHISHU_CONTROL_BASE_URL: controlBaseUrl,
      },
      timeout: 10 * 60_000,
    }), 'Node build');
    console.log('[BUILD] 构建 Spring Control Plane……');
    assertCommand(commandResult('mvn', ['-q', '-DskipTests', 'package'], {
      cwd: controlPlanePath,
      env: javaEnvironment,
      timeout: 10 * 60_000,
    }), 'Control Plane build');
  }

  const jarPath = join(controlPlanePath, 'target', 'zhishu-control-plane-0.1.0-SNAPSHOT.jar');
  const nodeEntryPath = join(projectRoot, 'dist-server', 'server', 'index.js');
  if (!existsSync(jarPath) || !existsSync(nodeEntryPath)) {
    throw new Error('Build output is missing. Run npm run demo:start without --skip-build first.');
  }

  const composeStatus = commandResult('docker', [
    'compose', '-f', composePath, 'ps', '--status', 'running', '--services',
  ]);
  assertCommand(composeStatus, 'Docker Compose status');
  const postgresWasRunning = composeStatus.stdout.split(/\r?\n/).includes('postgres');
  console.log('[START] 启动并等待 PostgreSQL……');
  assertCommand(commandResult('docker', [
    'compose', '-f', composePath, 'up', '-d', '--wait', '--wait-timeout', '90', 'postgres',
  ], { timeout: 120_000 }), 'PostgreSQL startup');

  const label = timestampLabel();
  const logsPath = join(demoRoot, 'logs');
  const controlStdout = join(logsPath, `control-${label}.out.log`);
  const controlStderr = join(logsPath, `control-${label}.err.log`);
  const nodeStdout = join(logsPath, `node-${label}.out.log`);
  const nodeStderr = join(logsPath, `node-${label}.err.log`);

  console.log('[START] 启动 Spring Control Plane……');
  const controlPid = launchProcess(preflight.java.executable, ['-jar', jarPath], {
    cwd: controlPlanePath,
    env: {
      ...javaEnvironment,
      SERVER_PORT: String(controlPort),
      ZS_RUNTIME_TOKEN: sharedToken,
      ZS_PROJECT_CONTROL_TOKEN: projectControlToken,
      ZHISHU_RUNTIME_BASE_URL: nodeBaseUrl,
    },
    stdoutPath: controlStdout,
    stderrPath: controlStderr,
  });

  console.log('[START] 启动 Node Runtime……');
  const nodePid = launchProcess(process.execPath, [nodeEntryPath], {
    cwd: projectRoot,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      SERVER_PORT: String(nodePort),
      DATABASE_PATH: join(demoRoot, 'node-runtime.db'),
      ZS_RUNTIME_TOKEN: sharedToken,
      ZS_PROJECT_CONTROL_TOKEN: projectControlToken,
      ZHISHU_CONTROL_BASE_URL: controlBaseUrl,
    },
    stdoutPath: nodeStdout,
    stderrPath: nodeStderr,
  });

  const state = {
    schemaVersion: 2,
    startedAt: new Date().toISOString(),
    nodePid,
    controlPid,
    nodeBaseUrl,
    controlBaseUrl,
    sharedToken,
    projectControlToken,
    postgresStartedByScript: !postgresWasRunning,
    logs: { controlStdout, controlStderr, nodeStdout, nodeStderr },
  };
  await writeStackState(state);

  console.log('[WAIT] 等待 Control Plane health……');
  await waitForJson(`${controlBaseUrl}/actuator/health`, (body) => body?.status === 'UP', { timeoutMs: 120_000 });
  console.log('[WAIT] 等待 Node Runtime health……');
  await waitForJson(`${nodeBaseUrl}/health`, isZhishuNodeHealth, { timeoutMs: 120_000 });
  await waitForJson(`${nodeBaseUrl}/internal/runtime/v1/health`, (body) => body?.status === 'up', {
    timeoutMs: 30_000,
    headers: { Authorization: `Bearer ${sharedToken}` },
  });
  await assertProjectControlCapability(controlBaseUrl, projectControlToken);

  console.log('='.repeat(64));
  console.log('知枢 Demo 栈已就绪');
  console.log(`UI / Node: ${nodeBaseUrl}`);
  console.log(`Control Plane: ${controlBaseUrl}`);
  console.log('普通四步验证：npm run demo:verify');
  console.log('阶段 G8 验收：npm run demo:g8');
  console.log('停止：npm run demo:stop');
  if (arguments_.open && !openBrowser(nodeBaseUrl)) {
    console.warn(`[WARN] 无法自动打开浏览器，请手动访问 ${nodeBaseUrl}`);
  }
}

main().catch((error) => {
  console.error(`[FAIL] ${error.message}`);
  process.exitCode = 1;
});
