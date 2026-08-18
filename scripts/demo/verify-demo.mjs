#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  commandResult,
  createProjectRegistration,
  demoRepositoryPath,
  demoRoot,
  ensureDemoDirectories,
  fetchJson,
  loadTaskTemplates,
  parseArguments,
  readStackState,
  timestampLabel,
} from './lib.mjs';

const TERMINAL_STATUSES = new Set(['SUCCEEDED', 'FAILED', 'ABORTED']);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForTask(controlBaseUrl, taskId, options = {}) {
  const deadline = Date.now() + (options.timeoutMs ?? 10 * 60_000);
  const approvalIds = new Set();
  let latestTask = null;

  while (Date.now() < deadline) {
    latestTask = await fetchJson(`${controlBaseUrl}/api/v1/tasks/${taskId}`);
    if (TERMINAL_STATUSES.has(latestTask.status)) {
      return { task: latestTask, approvalCount: approvalIds.size };
    }

    const approvals = await fetchJson(`${controlBaseUrl}/api/v1/tasks/${taskId}/approvals`);
    for (const approval of approvals) {
      if (approvalIds.has(approval.id)) continue;
      console.log(`    [APPROVE] ${approval.toolName} (${approval.riskLevel})`);
      await fetchJson(`${controlBaseUrl}/api/v1/approvals/${approval.id}/decision`, {
        method: 'POST',
        body: { decision: 'APPROVED', message: '知枢固定 Demo 自动验收批准。' },
      });
      approvalIds.add(approval.id);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 750));
  }

  throw new Error(`Task ${taskId} timed out. Last state: ${JSON.stringify(latestTask)}`);
}

async function waitForArtifacts(controlBaseUrl, taskId, requiredTypes, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let artifacts = [];
  while (Date.now() < deadline) {
    artifacts = await fetchJson(`${controlBaseUrl}/api/v1/tasks/${taskId}/artifacts`);
    const types = new Set(artifacts.map((artifact) => artifact.artifactType));
    if (requiredTypes.every((type) => types.has(type))) return artifacts;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }
  throw new Error(`Task ${taskId} did not publish required artifacts: ${requiredTypes.join(', ')}. Actual: ${artifacts.map((artifact) => artifact.artifactType).join(', ')}`);
}

function parseSseFrame(frame) {
  const lines = frame.split(/\r?\n/);
  const id = lines.find((line) => line.startsWith('id:'))?.slice(3).trim();
  const event = lines.find((line) => line.startsWith('event:'))?.slice(6).trim();
  const dataText = lines.filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n');
  if (!id || !event || !dataText) return null;
  try {
    return { id: Number.parseInt(id, 10), event, data: JSON.parse(dataText) };
  } catch {
    return { id: Number.parseInt(id, 10), event, data: dataText };
  }
}

async function readDurableEvents(controlBaseUrl, taskId, timeoutMs = 20_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const events = [];
  try {
    const response = await fetch(`${controlBaseUrl}/api/v1/tasks/${taskId}/events`, {
      headers: { Accept: 'text/event-stream' },
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      throw new Error(`SSE replay returned ${response.status}.`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        const parsed = parseSseFrame(frame);
        if (!parsed) continue;
        events.push(parsed);
        if (['RUN_COMPLETED', 'RUN_FAILED', 'RUN_ABORTED'].includes(parsed.event)) {
          controller.abort();
          return events;
        }
      }
      if (done) return events;
    }
  } catch (error) {
    if (error?.name === 'AbortError' && events.length > 0) return events;
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function createMarkdownReport(report) {
  const lines = [
    '# 知枢固定 Demo 验收报告',
    '',
    `- 验收时间：${report.completedAt}`,
    `- 工作区：\`${report.workspacePath}\``,
    `- Project：\`${report.project.projectId}\``,
    `- Profile：\`${report.project.profileId}\``,
    `- 最终测试：${report.finalTest.passed ? '通过' : '失败'}`,
    '',
    '| 步骤 | 任务状态 | 审批 | 耐久事件 | Artifact |',
    '|---|---|---:|---|---|',
    ...report.tasks.map((task, index) => (
      `| ${index + 1}. ${task.key} | ${task.status} | ${task.approvalCount} | ${task.events.map((event) => event.event).join(' → ')} | ${task.artifactTypes.join(', ')} |`
    )),
    '',
    '## 最终测试输出',
    '',
    '```text',
    report.finalTest.output.trim(),
    '```',
    '',
  ];
  return `${lines.join('\n')}\n`;
}

async function main() {
  const arguments_ = parseArguments(process.argv.slice(2));
  const stack = await readStackState();
  assert(stack, 'Demo 栈未启动。请先运行 npm run demo:start。');
  await ensureDemoDirectories();

  const runLabel = timestampLabel();
  const workspacePath = join(demoRoot, 'workspaces', `run-${runLabel}`);
  await mkdir(workspacePath, { recursive: true });
  await cp(demoRepositoryPath, workspacePath, {
    recursive: true,
    filter: (source) => !source.endsWith('tasks.json'),
  });

  const baselineTest = commandResult('npm', ['test'], { cwd: workspacePath, timeout: 60_000 });
  assert(baselineTest.status !== 0, 'Demo fixture baseline unexpectedly passes; the governed repair would have nothing to fix.');

  const registrationRequest = createProjectRegistration(workspacePath);
  console.log('[PROJECT] 登记隔离 Demo 工作区……');
  const project = await fetchJson(`${stack.controlBaseUrl}/api/v1/projects/ensure`, {
    method: 'POST',
    body: registrationRequest,
  });

  const templates = loadTaskTemplates();
  const taskResults = [];
  for (let index = 0; index < templates.length; index += 1) {
    const template = templates[index];
    console.log(`[TASK ${index + 1}/4] ${template.title}`);
    const created = await fetchJson(`${stack.controlBaseUrl}/api/v1/tasks`, {
      method: 'POST',
      body: {
        projectId: project.projectId,
        profileId: project.profileId,
        title: template.title,
        objective: template.objective,
        additionalContext: {
          historySummary: `固定 Demo 验收 run=${runLabel}，step=${index + 1}/4。严格遵守本步骤的读写和命令限制。`,
        },
      },
      timeoutMs: 30_000,
    });
    console.log(`    taskId=${created.taskId}`);
    const completed = await waitForTask(stack.controlBaseUrl, created.taskId, {
      timeoutMs: Number.parseInt(String(arguments_.taskTimeoutMs ?? 10 * 60_000), 10),
    });
    assert(completed.task.status === 'SUCCEEDED', `${template.key} ended as ${completed.task.status}: ${completed.task.errorCode ?? ''} ${completed.task.errorMessage ?? ''}`);
    assert(completed.approvalCount >= template.expect.minimumApprovals, `${template.key} expected at least ${template.expect.minimumApprovals} approval(s), got ${completed.approvalCount}.`);
    const artifacts = await waitForArtifacts(
      stack.controlBaseUrl,
      created.taskId,
      template.expect.artifactTypes,
    );
    const events = await readDurableEvents(stack.controlBaseUrl, created.taskId);
    assert(events.length > 0, `${template.key} has no durable SSE events.`);
    const sequenceNumbers = events.map((event) => event.data?.sequenceNo).filter(Number.isFinite);
    assert(sequenceNumbers.every((value, sequenceIndex) => sequenceIndex === 0 || value > sequenceNumbers[sequenceIndex - 1]), `${template.key} event sequence is not strictly increasing.`);
    taskResults.push({
      key: template.key,
      title: template.title,
      taskId: created.taskId,
      attemptId: completed.task.attemptId,
      runtimeRunId: completed.task.runtimeRunId,
      status: completed.task.status,
      approvalCount: completed.approvalCount,
      events,
      artifacts,
      artifactTypes: [...new Set(artifacts.map((artifact) => artifact.artifactType))],
    });
    console.log(`    [PASS] approvals=${completed.approvalCount}, artifacts=${taskResults.at(-1).artifactTypes.join(',')}`);
  }

  const finalTest = commandResult('npm', ['test'], { cwd: workspacePath, timeout: 60_000 });
  const finalOutput = `${finalTest.stdout ?? ''}\n${finalTest.stderr ?? ''}`;
  assert(finalTest.status === 0, `Final fixture tests failed:\n${finalOutput}`);
  const repairedSource = await readFile(join(workspacePath, 'src', 'pricing.mjs'), 'utf8');
  assert(repairedSource !== await readFile(join(demoRepositoryPath, 'src', 'pricing.mjs'), 'utf8'), 'The governed write task did not change pricing.mjs.');

  const report = {
    schemaVersion: 1,
    runId: randomUUID(),
    startedAt: runLabel,
    completedAt: new Date().toISOString(),
    workspacePath,
    project,
    baselineTest: {
      expectedFailureObserved: true,
      output: `${baselineTest.stdout ?? ''}\n${baselineTest.stderr ?? ''}`,
    },
    tasks: taskResults,
    finalTest: { passed: true, output: finalOutput },
  };
  const evidenceBase = join(demoRoot, 'evidence', `demo-${runLabel}`);
  await writeFile(`${evidenceBase}.json`, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(`${evidenceBase}.md`, createMarkdownReport(report), 'utf8');

  console.log('='.repeat(64));
  console.log('四步固定 Demo 验收通过');
  console.log(`证据 JSON：${evidenceBase}.json`);
  console.log(`证据报告：${evidenceBase}.md`);
  console.log('最终测试：全部通过');
}

main().catch((error) => {
  console.error(`[FAIL] ${error.message}`);
  process.exitCode = 1;
});
