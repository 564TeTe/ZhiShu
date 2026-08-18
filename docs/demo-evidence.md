# 知枢固定 Demo 脱敏验收证据

本文档是 2026-08-12 两轮真实演示的可提交摘要。完整 JSON 包含每个 RuntimeEvent 和 Artifact 正文，保存在本地被 Git 忽略的 `.zhishu-demo/evidence`；本文不包含共享令牌、用户凭据或模型密钥。

## 验收环境

- Node Runtime：隔离端口 3012。
- Spring Control Plane：隔离端口 8082。
- PostgreSQL 16：Docker Compose。
- Executor：本机真实 Claude Code CLI / Claude Agent SDK。
- Fixture：每轮复制新的 `demo-repository`，基线固定为 3 项测试中 1 项通过、2 项失败。
- 原有 3001 Node 服务全程保持运行，证明隔离 Demo 没有停止或占用用户现有进程。

## 第一轮

| 步骤 | Task 状态 | 审批次数 | 必需 Artifact | 验收结果 |
|---|---|---:|---|---|
| 只读分析 | SUCCEEDED | 0 | SUMMARY | 通过 |
| 审批写入 | SUCCEEDED | 1 | FILE_CHANGE、SUMMARY | 通过；真实 Edit 审批 |
| 审批测试 | SUCCEEDED | 2 | TEST_REPORT、SUMMARY | 通过；真实 Bash 审批 |
| 交付总结 | SUCCEEDED | 0 | SUMMARY | 通过 |

- 最终独立测试：3/3 通过。
- 每个任务都从 SSE 初始游标重放耐久事件，并观察到终态事件。
- 事件 sequenceNo 严格递增。

## 第二轮

| 步骤 | Task 状态 | 审批次数 | 必需 Artifact | 验收结果 |
|---|---|---:|---|---|
| 只读分析 | SUCCEEDED | 0 | SUMMARY | 通过 |
| 审批写入 | SUCCEEDED | 1 | FILE_CHANGE、SUMMARY | 通过；真实 Edit 审批 |
| 审批测试 | SUCCEEDED | 1 | TEST_REPORT、SUMMARY | 通过；真实 Bash 审批 |
| 交付总结 | SUCCEEDED | 0 | SUMMARY | 通过 |

- 最终独立测试：3/3 通过。
- 每个任务都从 SSE 初始游标重放耐久事件，并观察到终态事件。
- 事件 sequenceNo 严格递增。

## 自动化回归

| 验证 | 结果 |
|---|---:|
| 两轮真实 AgentTask | 8/8 成功 |
| 两轮修复后 Fixture 测试 | 每轮 3/3 通过 |
| Spring Maven/Testcontainers | 20/20 通过 |
| Runtime/Outbox 定向回归 | 18/18 通过 |
| Demo 脚本单元测试 | 5/5 通过 |
| 环境预检 | 11/11 通过 |
| TypeScript typecheck | 通过 |
| 前后端生产 build | 通过 |
| ESLint | 0 errors；222 条上游既有 warnings |
| `git diff --check` | 通过；仅有既有 LF/CRLF 提示 |

## 停止与隔离验证

- `demo:stop` 只终止状态文件记录的 Node/Spring PID。
- Demo 结束后 3012 和 8082 均不再监听。
- PostgreSQL 在脚本运行前已存在，因此保持运行且未删除数据卷。
- 原有 3001 `/health` 在 Demo 停止后仍返回 `ok`。

## 可复现命令

```powershell
npm run demo:check
npm run demo:start
npm run demo:verify
npm run demo:verify
npm run demo:stop
```

端口被占用时使用：

```powershell
node scripts/demo/start-stack.mjs --node-port 3012 --control-port 8082
```

详细的环境、安全和文件布局见 [Demo 运行手册](demo-runbook.md)。
