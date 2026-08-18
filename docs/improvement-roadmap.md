# 知枢后续完善路线

当前版本已经足够作为秋招主项目：有真实 Agent 执行、状态机、人工审批、幂等、可靠事件、SSE、Artifact、前端闭环，以及连续两轮可复现证据。后续应优先补“故障闭环”，而不是继续增加技术栈数量。

## P0：投递前最值得完成

### 1. Runtime Heartbeat / Lease 与失联判定

- Node Worker 周期性续租，Spring 保存最后心跳与 Lease 到期时间。
- Lease 到期后将仍处于 `STARTING / RUNNING / WAITING_APPROVAL` 的 Attempt 标记为 `RUNTIME_LOST` 或失败终态。
- 定义重连、迟到事件和人工 Retry 的处理规则。

这会补上当前最大的可靠性边界，也能在面试中完整回答“Node 进程突然崩溃怎么办”。

### 2. Approval Timeout

- Approval 增加 `expiresAt`，到期自动拒绝或按 Policy 处置。
- 超时决策通过现有幂等 Decision 命令送回 Runtime。
- UI 展示倒计时、超时原因和审计记录。

它能避免 Provider 永久等待，让人工审批从“能用”升级为完整治理闭环。

## P1：明显提升完成度

### 3. Artifact 文件化

- 大文本、Diff、测试报告转为文件或对象存储，数据库只保存元数据和摘要。
- 增加下载接口、大小限制、内容类型校验和保留策略。
- UI 支持预览、下载与按 Attempt 对比。

### 4. Outbox 死信处置

- 增加最大重试/人工介入阈值、失败事件列表和手工重放。
- 暴露 pending、oldest age、retry count 与 dead-letter 指标。
- 保留原事件身份，重放仍由 Spring 唯一约束保证幂等。

### 5. 安全与权限

- 从共享 Runtime Token 演进为短期凭证或可轮换密钥。
- 增加用户身份、RBAC、项目隔离和 Approval 审计导出。
- 明确日志与 Artifact 中的秘密脱敏规则。

## P2：有明确场景再做

- Worker 注册、能力标签、并发配额和多机调度。
- 正式 AgentTask 对 Codex 等更多 Executor 的契约适配与真实验收。
- OpenTelemetry Trace，把 Task、Attempt、Runtime Run、Event 串成一条调用链。
- Redis、消息队列、Kubernetes 只在多实例、吞吐或部署需求真实出现后引入。

## 秋招建议

投递前完成 P0 中任意一项就有明显加分；两项都完成后，应把时间转向录制 Demo、整理 README、练习 3 分钟讲解和准备故障追问。项目已经具备足够宽度，接下来可靠性深度和表达质量比继续加功能更重要。
