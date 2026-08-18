#!/usr/bin/env node
import { rm } from 'node:fs/promises';

import {
  commandResult,
  composePath,
  getProcessCommandLine,
  isProcessRunning,
  processCommandMatches,
  readStackState,
  statePath,
} from './lib.mjs';

async function waitForExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessRunning(pid)) return true;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  return !isProcessRunning(pid);
}

async function stopProcess(name, pid, expectedPath) {
  if (!isProcessRunning(pid)) {
    console.log(`[STOP] ${name} 未运行。`);
    return;
  }
  const commandLine = getProcessCommandLine(pid);
  if (!processCommandMatches(commandLine, expectedPath)) {
    throw new Error(`${name} PID ${pid} 的启动命令与知枢不匹配，拒绝停止。请人工检查陈旧状态文件。`);
  }
  console.log(`[STOP] ${name} PID ${pid}……`);
  if (process.platform === 'win32') {
    commandResult('taskkill.exe', ['/PID', String(pid), '/T'], { timeout: 10_000 });
    if (!(await waitForExit(pid, 5_000))) {
      commandResult('taskkill.exe', ['/F', '/PID', String(pid), '/T'], { timeout: 10_000 });
    }
  } else {
    process.kill(-pid, 'SIGTERM');
    if (!(await waitForExit(pid, 5_000))) process.kill(-pid, 'SIGKILL');
  }
}

async function main() {
  const state = await readStackState();
  if (!state) {
    console.log('没有找到由 Demo 脚本启动的服务。');
    return;
  }

  await stopProcess('Node Runtime', state.nodePid, 'dist-server/server/index.js');
  await stopProcess(
    'Spring Control Plane',
    state.controlPid,
    'control-plane/target/zhishu-control-plane-0.1.0-SNAPSHOT.jar',
  );
  if (state.postgresStartedByScript) {
    console.log('[STOP] 停止 Demo PostgreSQL（数据卷保留）……');
    const result = commandResult('docker', ['compose', '-f', composePath, 'down'], { timeout: 120_000 });
    if (result.error || result.status !== 0) {
      throw new Error(`Could not stop PostgreSQL: ${result.stderr || result.stdout}`);
    }
  } else {
    console.log('[STOP] PostgreSQL 在脚本运行前已存在，保持运行。');
  }

  await rm(statePath, { force: true });
  console.log('Demo 服务已停止；日志、工作区和验收证据仍保留在 .zhishu-demo。');
}

main().catch((error) => {
  console.error(`[FAIL] ${error.message}`);
  process.exitCode = 1;
});
