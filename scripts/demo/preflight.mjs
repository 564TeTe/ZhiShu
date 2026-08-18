#!/usr/bin/env node
import { runPreflight } from './lib.mjs';

const result = runPreflight();

console.log('知枢 Demo 环境检查');
console.log('='.repeat(56));
for (const check of result.checks) {
  console.log(`${check.ok ? '[PASS]' : '[FAIL]'} ${check.name} — ${check.detail}`);
}
console.log('='.repeat(56));
console.log(result.ok ? '环境检查通过，可以运行 npm run demo:start。' : '环境检查失败，请先修复 FAIL 项。');

if (!result.ok) process.exitCode = 1;
