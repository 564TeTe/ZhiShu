# 知枢黄金版实施进度记录

> 本文档记录“知枢——AI 研发协作与 Coding Agent 编排平台”的真实实施状态。  
> 只把已经写入代码并经过相应验证的能力标记为完成；设计完成、代码完成、联调完成和演示完成分别记录，不混为一谈。

## 1. 文档信息

| 项目 | 内容 |
|---|---|
| 当前版本 | `progress-v0.20` |
| 最后更新 | 2026-08-14 |
| 对应建设计划 | `知枢_黄金版_秋招主项目建设计划书_v1.0.md` |
| 项目目录 | `$REPO_ROOT`（本地仓库根目录） |
| 当前阶段 | 第五阶段核心交付完成；README 入口、最终架构、面试讲稿、简历描述和脱敏验收证据已形成，后续只做按需增强与投递前演练 |
| 总体判断 | 黄金版主链路、可靠性加分项、重复 Demo 和招聘材料已形成闭环；项目可复现、可展示、可讲解，并明确保留单机版边界 |
| 粗略完成度 | 约 98%，剩余为 Approval Timeout、Heartbeat/Lease、Artifact 文件下载等非黄金主链路增强 |
| Git 状态 | 工作区存在用户原有修改及本轮新增修改，尚未提交 |

## 2. 项目目标

知枢不是重新实现 Claude Code 或 Codex，而是在现有 React + Node.js Agent Runtime 上增加一个 Spring Boot Control Plane，把一次不可治理的 Agent 调用升级为可追踪、可审批、可取消、可重试、可归档的研发任务。

目标架构：

```text
普通 Chat
React ───────── WebSocket/HTTP ─────────> Node ─────────> Claude/Codex

正式 Agent Task
React ───────── REST/SSE ───────────────> Spring Boot Control Plane
                                              │             ▲
                                              │ Runtime     │ RuntimeEvent
                                              ▼             │
                                         Node Execution Plane
                                              │
                                              ▼
                                      Claude Provider Runtime
```

黄金版最终主链路：

```text
创建 AgentTask
  → 创建 TaskAttempt 和 Profile Snapshot
  → Spring 通过 Runtime Protocol 调用 Node
  → Node 启动真实 Claude Agent
  → Agent 读取/修改代码并运行测试
  → Node 回传结构化 RuntimeEvent
  → Spring 幂等入库、更新状态并通过 SSE 推送
  → 高风险工具触发 Approval
  → 支持 Approve / Deny / Cancel / Retry
  → 展示 Summary / Git Diff / Test Report
```

## 3. 阶段总览

| 阶段 | 状态 | 主要产出 | 还差什么 |
|---|---|---|---|
| 阶段 0：代码走查与 Permission Hook Spike | 已完成 | Node 改造点、权限等待机制、协议草案、真实 SDK 审批往返 | Approval Timeout 可继续增强 |
| 阶段 1：Runtime Protocol 与控制面骨架 | 已完成 | Node Runtime API、Start 幂等、配置预检、Spring 工程、核心表和状态机 | 可继续增强多 Executor |
| 阶段 2：Task/Event/SSE 纵向链路 | 已完成 v1 | 创建/查询 Task、事件接收、幂等入库、状态投影、SSE 补历史 | SSE heartbeat 可继续增强 |
| 阶段 3：Approval/Cancel/Retry 闭环 | 已完成 v1 | 审批决策、取消、重试、历史 Attempt、控制命令幂等 | Approval Timeout 尚未实现 |
| 阶段 4：Artifact 与任务中心 UI | 已完成 v1 | 任务列表、创建、时间线、审批、取消、重试、五类 Artifact 协议/存储/展示 | Attempt 历史独立视图与 Artifact 文件下载可继续增强 |
| 阶段 5：测试、Demo 与简历材料 | 已完成核心交付 | 真库/真实 Claude/浏览器 E2E、Testcontainers、固定 Demo、README、架构、面试与简历材料 | 投递前按实际岗位裁剪与演练 |
| Reliability Bonus | 部分完成 | Runtime Event Outbox、指数退避、重启恢复、健康指标 | Heartbeat/Lease、Provider Run 崩溃恢复、人工死信处理可后续增强 |

## 4. 阶段 0：现有 Node Runtime 走查

### 4.1 已完成

- 定位现有 Provider Runtime 的启动、消息、完成、异常和中止出口。
- 确认 Claude Permission Hook 已具备 `canUseTool` 和 pending Promise 等待机制。
- 确认普通工具默认审批等待约 55 秒，交互类工具可无限等待，并且支持 AbortSignal。
- 确认 Runtime API 应作为独立后端模块挂载，不侵入普通 Chat 主链路。
- 确认 Node 使用自己的 SQLite 保存 Runtime Command 幂等记录；Spring 不读取 Node SQLite。
- 输出协议、影响面和审批 Spike 文档。

### 4.2 相关文件

- `docs/node-impact-map.md`
- `docs/permission-hook-spike.md`
- `docs/runtime-protocol.md`

### 4.3 后续增强

- 固定 Demo 已连续完成真实 `Edit`/`Bash` 权限请求暂停、Spring 审批和 Node 恢复工具的完整往返。
- Approval Timeout 与实际 SDK 等待上限仍可补充专门的超时 E2E。

## 5. 阶段 1：Node Runtime Protocol

### 5.1 Runtime API

已实现以下内部接口：

| 方法 | 地址 | 作用 | 当前状态 |
|---|---|---|---|
| POST | `/internal/runtime/v1/runs` | 幂等启动一次 Attempt | 已实现、已测试 |
| POST | `/internal/runtime/v1/runs/{runtimeRunId}/cancel` | 中止活动 Run | 已实现基础调用，命令持久化幂等待补 |
| POST | `/internal/runtime/v1/runs/{runtimeRunId}/approvals/{runtimeApprovalId}/decision` | 处理审批决定 | 已实现基础调用，命令持久化幂等待补 |

### 5.2 安全边界

- 使用 `ZS_RUNTIME_TOKEN` Bearer Token 保护双向内部接口。
- Token 未配置时内部接口返回 `503`。
- Token 比较使用 timing-safe compare。
- Spring 和 Node 不共享数据库，只通过协议中的 `taskId`、`attemptId`、`runtimeRunId` 关联。

### 5.3 Start 幂等

Node SQLite 已新增 `runtime_command_dedup` 表，保存：

- `idempotencyKey`
- command type
- 语义请求 SHA-256
- 首次接收产生的响应

行为：

```text
相同 key + 相同语义内容  → 返回第一次的 runtimeRunId
相同 key + 不同语义内容  → 409 IDEMPOTENCY_CONFLICT
```

`requestId` 不参与语义哈希，因此 HTTP 重试可以生成新的 requestId，同时仍命中原有 Start 结果。

### 5.4 Runtime Event Adapter

Node 已将 Provider 消息映射成以下事件：

- `RUN_STARTED`
- `AGENT_STATUS`
- `COMMAND_COMPLETED`
- `APPROVAL_REQUIRED`
- `APPROVAL_RESOLVED`
- `ERROR`
- `RUN_COMPLETED`
- `RUN_FAILED`
- `RUN_ABORTED`

每个 Run 的 `sequenceNo` 从 1 开始单调递增，事件上报在 Run 内串行化。

### 5.5 Prompt Assembly 当前状态

Node 已将以下信息组装进中文任务 Prompt：

- objective
- projectRef
- capabilities
- permissionPolicy
- additional context

当前属于 `task-v1` 第一版。后续仍需要补充明确的 Expected Result、Artifact 输出约束，以及为演示仓库固定任务模板。

### 5.6 主要文件

- `server/modules/runtime/runtime.routes.ts`
- `server/modules/runtime/runtime.service.ts`
- `server/modules/runtime/runtime-event-reporter.service.ts`
- `server/modules/database/repositories/runtime-command-dedup.ts`
- `server/shared/types.ts`
- `contracts/runtime-v1/openapi.yaml`
- `contracts/runtime-v1/runtime-events.schema.json`

## 6. 阶段 1：Spring Boot Control Plane 骨架

### 6.1 技术栈

- Java 21
- Spring Boot 3.5.16
- Spring MVC
- Spring Validation
- Spring Actuator
- Spring RestClient
- MyBatis-Plus 3.5.17
- PostgreSQL 16
- Flyway
- Maven
- JUnit 5

### 6.2 已建立的领域模型

- `Project`
- `AgentProfile`
- `AgentTask`
- `TaskAttempt`
- `TaskEvent`
- `ApprovalRequest`
- `TaskArtifact`
- `AgentProfileSnapshot`

### 6.3 Attempt 状态机

已实现状态：

```text
PENDING
STARTING
RUNNING
WAITING_APPROVAL
CANCELLING
SUCCEEDED
FAILED
ABORTED
```

已实现的主要转换：

```text
PENDING          → STARTING / FAILED
STARTING         → RUNNING / CANCELLING / FAILED
RUNNING          → WAITING_APPROVAL / CANCELLING / SUCCEEDED / FAILED
WAITING_APPROVAL → RUNNING / CANCELLING / FAILED
CANCELLING       → ABORTED / FAILED
```

`SUCCEEDED`、`FAILED`、`ABORTED` 为终态。

### 6.4 TaskOrchestrator 语义

- 先持久化 `PENDING` Attempt，再跨网络调用 Node。
- 不持有跨 Node HTTP 调用的数据库事务。
- Node 返回 `202 Accepted` 后才写入 `runtimeRunId` 并进入 `STARTING`。
- Node 调用失败时 Attempt 和 Task 进入 `FAILED`。
- Start 使用稳定的 `{attemptId}:start` 作为幂等键。

### 6.5 数据库迁移

`V1__golden_core.sql` 已建立：

- `project`
- `agent_profile`
- `agent_task`
- `task_attempt`
- `task_event`
- `approval_request`
- `task_artifact`
- 必要的外键、唯一约束和查询索引

`V2__event_projection.sql` 已增加：

- `task_event.runtime_run_id`
- `task_event.projected_at`
- 未投影事件索引

## 7. 阶段 2：Task REST API

### 7.1 已实现接口

| 方法 | 地址 | 说明 |
|---|---|---|
| POST | `/api/v1/tasks` | 创建 Task 并启动第一个 Attempt |
| GET | `/api/v1/tasks/{taskId}` | 查询当前 Task 和当前 Attempt 快照 |
| GET | `/api/v1/tasks/{taskId}/events` | 订阅持久化事件 SSE 流 |
| POST | `/internal/control/v1/events:batch` | Node 批量回传 Runtime Event |

### 7.2 创建任务流程

```text
CreateTaskRequest
  → 校验 projectId/profileId 对应已启用配置
  → 创建 PENDING AgentTask
  → 创建 PENDING TaskAttempt
  → 冻结 AgentProfileSnapshot
  → 调用 Node Runtime Start
  → Node 202 后更新为 STARTING
  → 返回当前 TaskView
```

当前接口直接启动首次 Attempt。项目后期如果需要“先保存草稿再执行”，再单独增加 Draft 语义；黄金版不引入该复杂度。

### 7.3 Profile Snapshot

Attempt 创建时冻结：

- executor
- modelAlias
- capabilities
- requireApprovalFor
- timeoutSeconds
- promptVersion

校验约束：审批策略只能引用已经启用的 Capability；timeout 必须为正数；promptVersion 不能为空。

## 8. 阶段 2：Runtime Event 幂等与状态投影

### 8.1 事件接收

内部入口：

```text
POST /internal/control/v1/events:batch
Authorization: Bearer ${ZS_RUNTIME_TOKEN}
```

接收流程：

```text
验证协议版本
  → 验证 taskId/attemptId/runtimeRunId 关系
  → 按 eventId 和 attemptId+sequenceNo 幂等插入
  → 对未投影事件按 sequenceNo 排序
  → 推进 Attempt 状态
  → 同步当前 Task 状态
  → 事务提交后通知 SSE 订阅者
```

### 8.2 幂等约束

数据库约束：

- `event_id UNIQUE`
- `UNIQUE(attempt_id, sequence_no)`

行为：

```text
完全相同的事件重放
  → 不重复插入
  → 返回 duplicates 计数

相同 eventId 或 sequenceNo，但内容不同
  → 拒绝事件
  → RUNTIME_EVENT_REJECTED
```

事件比较包括 task、attempt、runtimeRunId、序号、类型、payload 和 occurredAt。

### 8.3 202 与 RUN_STARTED 竞态

Node 的真实执行是异步的，可能出现：

```text
Node 已发送 RUN_STARTED
           ↓
Spring 仍未处理完 Node 的 202 响应
```

当前解决方式：

1. Runtime Event 先作为 inbox 记录持久化。
2. Attempt 若仍是 `PENDING`，不丢弃事件，也不非法跳到 `RUNNING`。
3. `TaskOrchestrator` 持久化 `STARTING` 后调用 reconciler。
4. reconciler 重放未投影事件，执行 `STARTING → RUNNING`。

这样既保持 `202 → STARTING → RUN_STARTED → RUNNING` 的业务语义，也不会因为网络时序丢事件。

### 8.4 Approval 投影

- `APPROVAL_REQUIRED` 创建 `approval_request`，初始为 `PENDING`。
- `APPROVAL_RESOLVED` 更新对应 Approval 状态和决定时间。
- Approval 的真实用户决策 API 尚未完成，这是下一阶段工作。

## 9. 阶段 2：SSE 实时事件流

### 9.1 当前行为

- 地址：`GET /api/v1/tasks/{taskId}/events`
- 使用 Spring MVC `SseEmitter`。
- 只发送已经持久化的 TaskEvent。
- 事件 ID 使用 PostgreSQL `task_event.id`。
- 支持标准 `Last-Event-ID` 请求头。
- 首次连接或重连时，从数据库分页补齐历史事件。
- 每页读取 200 条，直到追平当前进度。
- 事件事务提交后才通知在线订阅者，避免客户端看见尚未提交的数据。

### 9.2 当前限制

- 还没有心跳事件，长连接能否穿过代理需在部署阶段验证。
- 订阅注册表在单个 Spring 进程内，黄金版单实例足够；多实例需要 Redis/MQ，但不在当前范围。
- 前端尚未接入，所以还没有浏览器断线重连验收。

## 10. API 与文档产出

| 文件 | 作用 | 状态 |
|---|---|---|
| `contracts/runtime-v1/openapi.yaml` | Spring → Node Runtime 命令协议 | 已建立 |
| `contracts/runtime-v1/runtime-events.schema.json` | Node → Spring 事件 JSON Schema | 已建立 |
| `contracts/control-v1/openapi.yaml` | Task API、SSE、事件回调 API | 已建立 |
| `docs/runtime-protocol.md` | Runtime v1 关键语义 | 已建立，后续继续扩充 |
| `docs/node-impact-map.md` | Node 改造点 | 已建立 |
| `docs/permission-hook-spike.md` | Claude 审批机制验证记录 | 已建立 |
| `control-plane/README.md` | 控制面本地运行说明 | 已更新到第二阶段 |
| `control-plane/examples/bootstrap-local.sql` | 本地 Project/Profile 示例数据 | 已建立 |

## 11. 已完成验证

### 11.1 Java

最后一次验证日期：2026-08-12。

```text
mvn test
Tests run: 20
Failures: 0
Errors: 0
Skipped: 0
BUILD SUCCESS
```

覆盖内容：

- AgentProfileSnapshot 约束
- Attempt 状态机合法/非法转换
- `PENDING` 先于 Node 网络调用持久化
- Node 接受后进入 `STARTING`
- Node 不可用时记录 `FAILED`
- Task 创建服务
- 未知 Project/Profile 的拒绝
- Runtime Event 精确重放幂等
- `RUN_STARTED` 抢跑竞态与延迟投影
- Approval 生命周期状态投影
- Task/Attempt 状态同步
- Testcontainers 启动独立 PostgreSQL 16 并执行 Flyway V1/V2
- RuntimeEvent 首次接收与整批精确重放判重
- `STARTING → RUNNING → SUCCEEDED` 真库状态投影
- `ARTIFACT_PUBLISHED` 幂等写入、UUID 映射、Service 与 HTTP 查询

另外完成：

- `mvn package -DskipTests` 成功
- 生成可执行 Spring Boot JAR

### 11.2 Node/React 仓库

最后一次静态/构建验证日期：2026-08-12。

- `npm run typecheck`：通过。
- `npm run lint`：退出码 0，0 errors，222 个原项目 warnings。
- `npm run build`：客户端和服务端构建通过。
- `git diff --check`：通过。
- Artifact Runtime 定向测试：2 个通过，覆盖 Summary、File Change、Git Diff、Test Report、Error Report 识别与发布。
- `npm run build:client`：通过；存在项目既有 CSS 语法和大 chunk 警告，不阻塞构建。

完整 `npm test` 的最后已知结果为：244 passed、8 failed、1 skipped。8 个失败来自原有 Windows 路径、真实用户 Claude 配置污染和 Provider Skill 发现测试，不是本轮 Runtime 新增测试造成；后续进入最终验收前应隔离环境并清理这些基线失败。

### 11.3 PostgreSQL/Flyway

状态：**真实数据库验证已完成**。

已经进行的操作：

1. Docker PostgreSQL 16 容器健康运行，数据库为 `zhishu`。
2. Flyway V1/V2 已真实执行，Spring `/actuator/health` 返回 `UP`。
3. Task、Attempt、Event、Approval 与 Artifact 的 PostgreSQL UUID 映射均已通过真实链路验证。
4. Artifact E2E 中 `ARTIFACT_PUBLISHED` 先入 `task_event`，随后幂等投影到 `task_artifact`，查询 API 返回同一记录。
5. Testcontainers 可在空白 PostgreSQL 16 数据库中自动执行 Flyway V1/V2，并验证 Event/Artifact 重放幂等、状态投影、UUID 映射和 HTTP 查询；Docker 可用时测试实际执行，当前实测未跳过。

## 12. 当前未完成项与风险

### 12.1 黄金版关键缺口

- [x] Approval 用户决策 API。
- [x] Approve / Deny 调用 Node Runtime。
- [ ] Approval 超时处理。
- [x] Cancel API 与 `CANCELLING → ABORTED` 完整闭环。
- [x] Cancel 和 Approval 同时到达时的竞争控制。
- [x] Retry 新建 Attempt 并保留旧 Attempt 历史。
- [x] Cancel 和 Approval Decision 的持久化命令幂等。
- [x] Task Center / Task Detail 前端。
- [x] Approval 操作卡。
- [x] Artifact v1：Summary、File Change、Git Diff、Test Report、Error Report。
- [x] 真实 PostgreSQL/Flyway 集成测试。
- [x] 真实 Claude Agent E2E。
- [ ] 固定 Demo Repository 和重复演示脚本。

### 12.2 已知工程限制

1. Node Runtime 当前将活动 Run 保存在内存中；Node 重启后可以幂等返回旧的 Start 接受结果，但不能恢复正在执行的 Provider Run。
2. Runtime Event 已使用 SQLite Persistent Outbox 并提供积压健康指标；尚未实现告警通知和人工重放界面。
3. Artifact v1 只保存内联纯文本；大文件对象存储、下载和保留策略尚未实现。
4. Spring SSE 目前没有 heartbeat。
5. 控制面没有认证普通用户；目前只保护 Node → Spring 的内部事件接口。
6. Task 创建失败后会保留已创建的失败 Task/Attempt，这是刻意保留审计记录，但 API 的错误返回和前端呈现仍需统一。

### 12.3 工作区风险

当前 Git 工作区在开始本项目实施前就存在较多用户修改，包括品牌、Vision、Sidebar 和其他页面变化。本轮没有执行 reset、checkout 或覆盖性清理，也没有创建提交。

后续提交前必须：

1. 区分用户原有修改与知枢 Control Plane/Runtime 修改。
2. 按逻辑拆分提交，避免一个提交混入无关 UI 改动。
3. 再运行一次 `git diff --check`、类型检查、测试和构建。

## 13. 下一阶段实施计划

下一阶段目标：完成 Approval、Cancel、Retry 的后端闭环，并让 React 出现第一个可操作的任务控制台。

> 2026-08-12 更新：上述第一版代码已经完成。接下来优先启动 PostgreSQL、Spring、Node 三个进程，执行真实 Claude Permission Hook、Cancel 和 Retry 联调；联调通过后再进入 Artifact。

### 13.1 后端任务

#### A. Approval

- 增加审批列表和审批详情查询。
- 增加 `POST /api/v1/approvals/{id}/decision`。
- 使用数据库条件更新保证只允许 `PENDING → APPROVED/DENIED/EXPIRED` 一次。
- 在数据库提交后调用 Node Approval Decision。
- 为跨进程命令增加稳定 `idempotencyKey`。
- 处理 Node 返回 `APPROVAL_EXPIRED`。
- 验证 Cancel 后迟到 Approve 必须失败。

#### B. Cancel

- 增加 `POST /api/v1/tasks/{taskId}/cancel`。
- 只允许 `STARTING/RUNNING/WAITING_APPROVAL → CANCELLING`。
- 先用 CAS 写入 `CANCELLING`，再调用 Node。
- 收到 `RUN_ABORTED` 后进入 `ABORTED`。
- 取消时关闭该 Attempt 的所有 Pending Approval。
- 重复 Cancel 必须返回同一业务结果，不重复执行副作用。

#### C. Retry

- 增加 `POST /api/v1/tasks/{taskId}/retry`。
- 只允许终态 Task 重试。
- 永远创建新的 TaskAttempt，并使 attemptNumber 递增。
- 旧 Attempt 的 Event、Approval 和 Artifact 保留。
- Task.currentAttemptId 切换到新 Attempt。

### 13.2 前端任务

- 新增 Task Center 入口。
- 任务列表展示标题、状态、创建时间和当前 Attempt。
- Task Detail 订阅 SSE 并展示时间线。
- `WAITING_APPROVAL` 时展示 Approval Dialog。
- 运行中展示 Cancel。
- 终态失败展示 Retry。
- SSE 断线后使用最后事件 ID 补历史。

### 13.3 下一阶段验收条件

- [ ] 真正触发一次 Claude Permission Hook。
- [ ] Approve 后工具继续执行。
- [ ] Deny 后工具不执行。
- [ ] Cancel 后对应 Provider Run 真正终止。
- [ ] Cancel 后迟到 Approval 返回冲突。
- [ ] Retry 创建 Attempt #2，Attempt #1 历史仍可查询。
- [ ] 页面实时展示 `RUNNING → WAITING_APPROVAL → RUNNING → SUCCEEDED`。
- [ ] Approval/Cancel/Retry 核心单元测试通过。
- [ ] Node 类型检查、Lint 和构建通过。
- [ ] Maven 测试和打包通过。

## 14. 本地恢复与验证命令

### 14.1 Java 环境

本机默认 Maven 会继承旧 Java 8 的 `JAVA_HOME`，运行控制面前需执行：

```powershell
$env:JAVA_HOME='C:\Program Files\Java\jdk-21'
$env:Path="$env:JAVA_HOME\bin;$env:Path"
```

### 14.2 Java 测试与打包

```powershell
Set-Location "$REPO_ROOT\control-plane"
mvn test
mvn package
```

只运行 PostgreSQL 真库集成测试：

```powershell
mvn '-Dtest=GoldenCorePostgresIntegrationTest' test
```

该测试由 Testcontainers 创建临时 `postgres:16-alpine`，使用随机端口和独立数据库；Docker 不可用时会跳过，当前开发机与完整回归中均为实际执行、`Skipped: 0`。

### 14.3 PostgreSQL

```powershell
docker compose -f compose.yml up -d
docker compose -f compose.yml ps
```

Flyway 完成后加载本地样例：

```powershell
Get-Content examples/bootstrap-local.sql |
  docker compose exec -T postgres psql -U zhishu -d zhishu
```

### 14.4 Node/React 验证

```powershell
Set-Location $REPO_ROOT
npm run typecheck
npm run lint
npm run build
```

### 14.5 双向 Runtime 配置

Spring 和 Node 使用相同密钥：

```powershell
$env:ZS_RUNTIME_TOKEN='replace-with-a-long-random-secret'
```

Spring：

```powershell
$env:ZHISHU_RUNTIME_BASE_URL='http://127.0.0.1:3001'
```

Node：

```powershell
$env:ZHISHU_CONTROL_BASE_URL='http://127.0.0.1:8080'
```

## 15. Golden Core DoD 实时清单

说明：`部分完成` 表示代码已经存在，但尚未达到真实联调或演示验收。

| DoD | 状态 | 备注 |
|---|---|---|
| Spring Boot + PostgreSQL + Flyway 稳定启动 | 已完成 | PostgreSQL 16、Flyway V1/V2、Spring health 已真实验证 |
| 至少一个真实 Executor | 已完成 | Claude 已完成多轮真实任务与浏览器 E2E |
| AgentProfile Snapshot | 已完成 | 含验证和单测 |
| Task / Attempt 双层模型 | 已完成 | Retry 创建新 Attempt 并保留旧历史 |
| 202 后 STARTING、RUN_STARTED 后 RUNNING | 已完成 | 包含抢跑竞态处理和单测 |
| 三类 Runtime 终态正确驱动 | 已完成 | SUCCEEDED/FAILED/ABORTED 均有真实链路证据 |
| PromptAssembler task-v1 进入真实 Prompt | 代码完成 | 仍需 Demo 验收与结果约束增强 |
| Start/Cancel/Decision 持久化幂等 | 已完成 | Node SQLite 语义重放与冲突检查已覆盖 |
| RuntimeEvent 幂等落库 | 已完成 | 精确重放和冲突均处理 |
| RuntimeEvent Persistent Outbox | 已完成 v1 | Node SQLite 先持久化，支持退避重试、同 Run 顺序屏障与重启恢复 |
| SSE + Last-Event-ID | 已完成 v1 | 浏览器 Create/Retry/Approval/Cancel/Artifact 已联调 |
| Approval Approve/Deny | 已完成 v1 | 真实 Permission Hook 的 Approve/Deny 均已验证 |
| Approval Timeout | 未完成 | |
| Cancel/Approval 竞态 | 已完成 v1 | Cancel 优先规则与回归测试已存在 |
| Cancel 真正终止 Runtime | 已完成 v1 | 浏览器立即取消最终投影为 ABORTED |
| Artifact 结果展示 | 已完成 v1 | 五类契约/识别/存储/筛选 UI；Summary 已真实 E2E |
| 普通 Chat 不依赖 Spring | 已保持 | 未改普通 Chat 架构 |
| Testcontainers 核心测试 | 已完成 v1 | Flyway V1/V2、事件重放幂等、状态投影、Artifact/UUID/API 查询均已在 PostgreSQL 16 实测 |
| E2E Demo 连续两次稳定执行 | 未完成 | |
| 最终 README/Architecture/协议文档 | 部分完成 | 文档持续更新中 |

## 16. 更新规则

以后每完成一轮开发，在本文档中执行以下更新：

1. 修改“文档信息”的日期、版本和当前阶段。
2. 更新“阶段总览”。
3. 在对应阶段记录实际实现和关键设计决定。
4. 记录真实执行过的测试命令和结果，不只写“理论可行”。
5. 把环境失败和代码失败分开记录。
6. 更新“当前未完成项与风险”。
7. 更新 Golden Core DoD，不提前把“代码完成”写成“演示完成”。
8. 在下方追加一条变更日志。

## 17. 变更日志

### 2026-08-12 / progress-v0.4

- Node Cancel 与 Approval Decision 增加 SQLite 持久化幂等和语义冲突检测。
- Spring `RuntimeClient` 增加 Cancel 与 Approval Decision 命令。
- 增加 Approval 查询与 Approve/Deny API，并使用中间状态控制并发决策。
- 增加 Cancel API，采用 CAS 抢占并使 Pending Approval 失效。
- 增加 Retry API，每次重试创建新 Attempt 并保留旧历史。
- 增加 Cancel 优先于迟到 Approval 的事件投影规则。
- 增加任务列表、Attempt 历史和工作区自动注册接口。
- React 新增独立“Agent 任务”入口及第一版 Task Center。
- Task Center 支持任务创建、状态列表、SSE 时间线、审批、取消和重试。
- Java 测试增加至 15 个并全部通过。
- Node Runtime 定向测试增加至 10 个并全部通过。
- TypeScript 类型检查、Lint 和生产构建通过。

### 2026-08-12 / progress-v0.3

- 建立本实施进度文档。
- 汇总阶段 0、阶段 1 和阶段 2 的真实实现状态。
- 记录 Java 11 个测试全部通过。
- 记录 Node 类型检查、Lint 和构建结果。
- 记录 PostgreSQL 16 镜像下载失败的环境限制。
- 明确下一阶段为 Approval、Cancel、Retry 和前端 Task Center。

## 18. 真实 E2E 联调结果（2026-08-12 / progress-v0.5）

> 本节记录 PostgreSQL 16、Spring Boot、Node Runtime 与真实 Claude Code 的实际联调结果；如与前文“尚未验证”的旧记录冲突，以本节为准。

### 18.1 当前判断

- 当前阶段：阶段 3 后端控制闭环已完成真实 E2E，阶段 4 Task Center 第一版已完成代码实现。
- 粗略完成度：约 75%，用于排开发优先级，不代表最终交付比例。
- 下一阶段：Artifact、浏览器端 Task Center 验收、Testcontainers/自动化 E2E、Demo 与简历材料。

### 18.2 已完成的真实环境验证

1. PostgreSQL/Flyway
   - Docker PostgreSQL `16.14` 健康启动。
   - Flyway 在真实数据库上成功执行 `V1__golden_core.sql` 与 `V2__event_projection.sql`。
   - Spring `/actuator/health` 返回 `UP`。
2. 真实 Claude 任务
   - 任务 `bcfac50a-3a3c-4e0e-92e7-2610956e6cae` 完成 `STARTING -> RUNNING -> SUCCEEDED`。
   - 9 个 RuntimeEvent 按序入库且全部完成投影。
3. Retry
   - 同一任务 Retry 后创建 Attempt #2。
   - Attempt #1 与 Attempt #2 均保留且可查询，Attempt #2 最终 `SUCCEEDED`。
4. Approval Deny
   - 任务 `aaa34007-6338-43b3-9205-b3ce0c8ac050` 真实触发 Bash Permission Hook。
   - Spring 投影 Approval，任务进入 `WAITING_APPROVAL`。
   - Approval `e1119e46-8e21-4e68-8ac7-4277e45ac3a8` 被拒绝并落库为 `DENIED`。
   - Claude 收到拒绝结果后正常收尾，任务最终 `SUCCEEDED`，Bash 未执行。
5. Cancel
   - 任务 `d10237f9-b865-4e23-af4b-2a0e3eaf6eb1` 在创建后立即取消。
   - 控制链路最终收敛为 `ABORTED`，覆盖了取消早于 Claude SDK 活动会话注册的竞态。

### 18.3 本轮由真实联调发现并修复的问题

- Project `INSERT ... RETURNING UUID` 的 MyBatis/Java 21 映射失败：改为 SQL 返回文本并显式 `UUID.fromString`。
- Runtime 将内部 `runtimeRunId` 误作 Claude Resume Session ID：拆分为 `runtimeSessionKey` 与 Provider 原生 Session ID。
- Attempt、TaskEvent、Approval 查询的 PostgreSQL UUID Bean 映射为空：统一改为文本映射后显式转换。
- Runtime 工具设置字段与 Claude Adapter 契约不一致：改为 `toolsSettings`，并补充内联 `permissions.ask`。
- Cancel 在 Claude SDK 注册活动会话前到达会丢失：增加预取消队列，注册后立即 interrupt。
- Spring 与 Node 同一脚本启动时 `SERVER_PORT` 串用：联调启动时分别显式设置 `8080` 与 `3001`。

### 18.4 本轮验证证据

- Node/TypeScript：`npm run typecheck` 通过。
- Node 相关定向测试：9/9 通过；Runtime 核心测试单独为 6/6。
- Java：15/15 测试通过。
- `git diff --check` 通过，仅有既有 LF/CRLF 提示。
- 真实 E2E：Create/Run、事件投影、Retry、Approval Deny、Immediate Cancel 均已通过。

### 18.5 下一阶段验收目标

- 在真实浏览器中验收 Task Center：创建任务、SSE 时间线、审批卡、取消与重试。
- 增加 Approval Approve E2E，并验证工具获批后确实执行。
- 实现 Artifact：Summary、File Change、Git Diff、Test Report、Error Report。
- 用 Testcontainers 覆盖 Flyway、UUID 映射、状态投影和并发控制回归。
- 增加 RuntimeEvent Persistent Outbox，避免 Spring 暂时不可用时丢事件。
- 固定 Demo Repository 与一键启动/演示脚本，随后整理架构图、README 和简历描述。

## 19. Task Center 真实浏览器验收（2026-08-12 / progress-v0.6）

> 本节记录通过 Playwright CLI 驱动真实 Chromium 对 `http://localhost:3001` 完成的端到端验收；前端请求实际经过 CORS、Spring、PostgreSQL、Node Runtime 与 Claude，而不是使用 Mock API。

### 19.1 浏览器验收发现并修复的问题

1. Spring CORS 默认白名单只包含 Vite `5173`，整合 UI `3001` 的预检请求被拒绝。
   - 默认允许 `localhost/127.0.0.1` 的 `3001` 与 `5173`。
   - 保留 `ZHISHU_UI_ALLOWED_ORIGINS` 完整覆盖能力。
   - 增加合法来源与非法来源的 MVC CORS 回归测试。
2. Project ensure 在查询已有默认 Profile 时，PostgreSQL UUID 无法稳定映射到 Bean，返回的 `projectId/profileId` 为 `null`。
   - `ProjectCatalogMapper` 改为返回带引号别名的 UUID 文本列。
   - Repository 统一显式执行 `UUID.fromString`。
   - 增加已有 Project/Profile 查询分支的 Repository 回归测试。

### 19.2 已通过的真实浏览器链路

1. Create + SSE
   - 从 Task Center 创建“浏览器 E2E 只读任务”。
   - 列表显示 `运行中 · Attempt #1`，时间线即时出现 `RUN_STARTED`。
   - SSE 继续推送 `AGENT_STATUS` 与 `RUN_COMPLETED`，列表自动变为 `已完成`。
2. Retry
   - 在已完成任务上点击“重试”。
   - 同一任务创建 Attempt #2，保留 Attempt #1 事件，最终显示 `已完成 · Attempt #2`。
3. Approval Approve
   - “浏览器 E2E 审批通过”任务真实触发 Bash `git status --short`。
   - 页面显示工具输入和“允许/拒绝”操作，任务进入 `等待审批`。
   - 点击“允许”后，时间线出现 `APPROVAL_RESOLVED(APPROVED)`、`COMMAND_COMPLETED(isError=false)` 与 `RUN_COMPLETED`。
   - 证明获批命令实际继续执行且成功完成，并非只更新审批数据库状态。
4. Cancel
   - “浏览器 E2E 立即取消”任务运行时点击“取消”。
   - 列表自动变为 `已取消 · Attempt #1`，时间线追加 `RUN_ABORTED`，reason 为 `control_plane_cancelled`。
5. Visual QA
   - 三栏布局、状态色、按钮切换和时间线层级清晰，无明显遮挡或溢出。

### 19.3 验证证据

- Java：18/18 测试通过，其中新增 CORS 2 个、Project UUID 映射 1 个回归测试。
- Node/TypeScript：`npm run typecheck` 通过。
- `git diff --check` 通过，仅有仓库既有 LF/CRLF 提示。
- 原始 CORS 预检：`OPTIONS /api/v1/projects/ensure` 返回 `200`，`Access-Control-Allow-Origin: http://localhost:3001`。
- PostgreSQL：只读任务 Attempt #1/#2 均为 `SUCCEEDED`，审批任务为 `SUCCEEDED`，取消任务为 `ABORTED`。
- 截图：`output/playwright/task-center-create-sse-success.png`。
- 截图：`output/playwright/task-center-approval-approved.png`。
- 截图：`output/playwright/task-center-cancel-aborted.png`。

### 19.4 下一阶段

- 实现 Artifact：Summary、File Change、Git Diff、Test Report、Error Report，并接入 Task Center。
- 使用 Testcontainers 覆盖 Flyway、真实 PostgreSQL UUID 映射、状态投影与并发控制。
- 增加 RuntimeEvent Persistent Outbox，处理 Spring 暂时不可用时的事件可靠投递。
- 固定 Demo Repository，完善一键启动、演示脚本、架构图、README 与简历项目描述。

## 20. Artifact v1 全链路验收（2026-08-12 / progress-v0.7）

### 20.1 已实现能力

- Runtime 协议新增 `ARTIFACT_PUBLISHED` 强类型事件。
- Artifact 类型固定为 `SUMMARY`、`FILE_CHANGE`、`GIT_DIFF`、`TEST_REPORT`、`ERROR_REPORT`。
- Node Runtime 根据标准化 Provider 消息生成产物：
  - 最终 assistant 文本生成 Summary。
  - Edit/Write/NotebookEdit 成功结果生成 File Change。
  - `git diff` 命令结果生成 Git Diff。
  - 常见测试命令结果生成 Test Report。
  - Provider 或工具错误生成 Error Report。
- 每条产物包含 UUID、生产者、UTF-8 字节数、SHA-256、MIME 类型与元数据；内联文本上限为 200,000 字符。
- Spring 在 RuntimeEvent 事务投影中幂等写入既有 `task_artifact` 表。
- 新增 `GET /api/v1/tasks/{taskId}/artifacts`，按创建时间倒序返回跨 Attempt 产物。
- Task Center 新增任务产物区、五类筛选、命令上下文、Attempt 归属、生产者与创建时间展示。
- SSE 收到 `ARTIFACT_PUBLISHED` 后自动刷新产物，不需要手工刷新页面。
- Runtime JSON Schema 和 Control Plane OpenAPI 已同步 Artifact 事件与查询契约。

### 20.2 真实 E2E 证据

- 任务：`Artifact E2E Summary`。
- 最终有效执行：Attempt #3，`RUNNING -> SUCCEEDED`，用时约 16 秒。
- 真实 Claude 读取 `package.json` 后返回项目总结。
- PostgreSQL 事件顺序：
  `RUN_STARTED -> AGENT_STATUS/COMMAND_COMPLETED -> ARTIFACT_PUBLISHED(SUMMARY) -> RUN_COMPLETED`。
- `task_event` 中共 10 条事件全部完成投影，Artifact 位于 sequence #9，终态位于 #10。
- `task_artifact` 中的 Summary 为 `NODE_RUNTIME` 生产，`size_bytes=158`，SHA-256 与 API 返回一致。
- 浏览器快照确认“任务产物 / 任务总结 1”、Summary 内容、Attempt、生产者、时间和 `ARTIFACT_PUBLISHED #9` 时间线同时可见。
- 截图：`output/playwright/task-center-artifact-summary.png`。

### 20.3 自动化验证

- TypeScript：客户端与服务端 `tsc --noEmit` 均通过。
- Node Runtime Artifact 定向测试：2/2 通过，五类识别规则全部覆盖。
- Java：19/19 测试通过；新增 Artifact 信息事件投影测试通过。
- `npm run build:client` 通过；仅保留项目既有 CSS 语法和大 chunk 警告。
- `git diff --check` 在收尾阶段再次执行。

### 20.4 本轮环境发现

- 本机全局 `JAVA_HOME` 指向 Java 8，而项目要求 Java 21；Maven 命令必须显式切换 JDK 21。
- Node Runtime 自动回调 Spring 同时依赖 `ZS_RUNTIME_TOKEN` 与 `ZHISHU_CONTROL_BASE_URL`。
- 在 v0.7 旧实现中，只配置共享令牌但未配置回调地址时，Node 会本地输出事件，Spring Task 会停留在 STARTING；v0.9 已改为写入 Outbox 并持续重试，启动配置预检仍待补充。
- 本轮 E2E 使用只存在于进程环境中的临时共享令牌，没有写入仓库文件。

### 20.5 下一阶段

1. 用 Testcontainers 覆盖 Flyway、Artifact/Event 幂等、UUID 映射和状态投影。
2. 增加 Node Runtime Event Persistent Outbox、失败重试与启动配置预检。
3. 固定 Demo Repository 和一键启动/验收脚本，避免手工环境变量造成联调漂移。
4. 补 Artifact 文件存储/下载与保留策略，并增加 Attempt 历史独立视图。
5. 完善 README、架构图、演示脚本与简历项目描述。

### 2026-08-12 / progress-v0.7

- 完成 Artifact v1 的事件协议、Node 生成、Spring 投影、PostgreSQL 查询和 Task Center 展示。
- 五类 Artifact 识别规则完成自动化覆盖，Summary 完成真实 Claude + PostgreSQL + 浏览器 E2E。
- 同步 Runtime JSON Schema 与 Control Plane OpenAPI。
- Java 测试更新为 19/19，TypeScript 类型检查和前端生产构建通过。
- 记录 JDK 21、共享令牌和 Node 回调地址三个本地启动前置条件。

## 21. Testcontainers PostgreSQL 回归（2026-08-12 / progress-v0.8）

### 21.1 已实现能力

- Control Plane 新增 Testcontainers JUnit Jupiter 与 PostgreSQL 测试依赖，版本由 Spring Boot 3.5.16 依赖管理统一锁定为 1.21.4。
- 新增 `GoldenCorePostgresIntegrationTest`，每次使用临时 `postgres:16-alpine` 空库和随机端口，不读写本地开发库。
- 使用 `@DynamicPropertySource` 将临时 JDBC URL、用户名和密码注入 Spring Boot 测试上下文。
- Docker 不可用时允许跳过真库用例，避免普通开发环境误报；CI/本机有 Docker 时完整实际执行。

### 21.2 覆盖链路

1. Spring 启动时在空库执行 Flyway `V1__golden_core.sql` 与 `V2__event_projection.sql`。
2. 写入 Project、Profile、Task 与 `STARTING` Attempt 测试夹具。
3. 通过正式 `RuntimeEventIngestionService` 接收：
   `RUN_STARTED → ARTIFACT_PUBLISHED(SUMMARY) → RUN_COMPLETED`。
4. 验证 Attempt/Task 最终为 `SUCCEEDED`，终态时间由 `RUN_COMPLETED` 投影。
5. 原批次完整重放后结果为 `accepted=0, duplicates=3`，`task_event` 与 `task_artifact` 不重复增长。
6. 验证 Task/Attempt/Artifact 的 PostgreSQL UUID 映射、中文 UTF-8 内容与 JSONB metadata。
7. 通过 `GET /api/v1/tasks/{taskId}/artifacts` 的 MockMvc 请求验证最终 HTTP 契约。

### 21.3 实测结果

```text
mvn -Dtest=GoldenCorePostgresIntegrationTest test
Tests run: 1, Failures: 0, Errors: 0, Skipped: 0
BUILD SUCCESS

mvn test
Tests run: 20, Failures: 0, Errors: 0, Skipped: 0
BUILD SUCCESS
```

- Docker Desktop 29.1.5 被 Testcontainers 正常识别。
- PostgreSQL 16.14 临时容器成功启动。
- Flyway 从空 schema 成功迁移到 v2。
- 测试结束后临时容器由 Testcontainers/Ryuk 自动清理，开发数据库未被修改。

### 21.4 下一阶段

1. 实现 Node Runtime Event Persistent Outbox，补指数退避、重启恢复和死信可观测性。
2. 增加 Runtime 启动配置预检，避免回调地址或共享令牌缺失时 Task 长期停留在 `STARTING`。
3. 固定 Demo Repository 与一键启动/验收脚本，完成连续两次稳定演示。
4. 整理最终 README、架构图、面试讲解稿和简历项目描述。

### 2026-08-12 / progress-v0.8

- 完成 Testcontainers PostgreSQL 16 自动化集成测试。
- 覆盖 Flyway 空库迁移、RuntimeEvent 整批重放幂等、状态投影、Artifact 落库与查询、UUID/JSONB/中文内容映射。
- 定向真库测试 1/1、完整 Java 回归 20/20，均为 `Skipped: 0`。
- 阶段 5 后续主线切换为 Runtime Event Outbox 与 Demo 工程化。

## 22. Runtime Event Persistent Outbox（2026-08-12 / progress-v0.9）

### 22.1 已实现能力

- Node SQLite 新增 `runtime_event_outbox`，以 `event_id` 为主键，并约束 `(runtime_run_id, sequence_no)` 唯一。
- Runtime Reporter 的 `report` 先事务写入 Outbox，再由后台循环投递；Provider 执行不再等待 Spring HTTP 成功。
- 只有 Spring 返回成功状态后才删除事件；网络错误、超时、非 2xx、令牌缺失和回调地址缺失都会保留记录。
- 失败事件采用约 1 秒起步、最高 60 秒的带抖动指数退避。
- 同一 Runtime Run 只允许最低待投递 `sequenceNo` 出队，防止后续终态越过失败事件。
- Node 完成数据库初始化后自动启动投递器，扫描并恢复上一个进程遗留的事件。
- 优雅退出会停止定时器并等待当前 HTTP 投递结束，不删除未确认记录。
- Reporter 通过 Runtime 模块 barrel 暴露启动/停止生命周期，server composition root 不深层导入内部实现。

### 22.2 可靠性语义

```text
Provider message
  → 构造 RuntimeEvent
  → SQLite Outbox 持久化
  → 异步 HTTP 投递 Spring
  → 2xx：删除 Outbox 记录
  → 失败：记录 attempts/last_error/next_attempt_at
  → 到期按 sequenceNo 重试
  → Node 重启：继续扫描恢复
```

- 当前语义为至少一次投递（at-least-once）。
- 网络超时后可能重复发送，但 Spring 已通过 `event_id` 和 `(attempt_id, sequence_no)` 双重约束精确判重。
- Outbox 保证事件生成后不因 Spring 临时不可用而直接丢失；不保证恢复已经崩溃的 Provider 进程本身。

### 22.3 自动化验证

- 新增 SQLite 集成测试 2 个：关闭/重开连接后记录仍在、同 Run 顺序释放、精确重放与冲突拒绝。
- 新增 Reporter 测试 2 个：启动恢复、首次失败退避、后续事件阻塞、重试成功后依次清空。
- Outbox + Reporter + Runtime 定向回归：11/11 通过。
- Runtime + Database 模块回归：新增能力相关测试全部通过；总计 24/25，唯一失败为仓库既有 Windows 路径分隔符基线，与 Outbox 无关。
- `npm run typecheck`：通过。
- `npm run build`：客户端和服务端生产构建通过；保留项目既有 CSS 与大 chunk 警告。
- `npm run lint`：0 errors、222 个仓库既有 warnings；本轮触及文件定向 lint 为 0 errors/0 warnings。

### 22.4 当前限制与下一步

1. 增加启动配置预检，在接收 Start 前明确报告缺失的 `ZHISHU_CONTROL_BASE_URL` 或 `ZS_RUNTIME_TOKEN`。
2. 增加 Outbox pending/oldest/attempts 指标、健康检查与死信告警；当前失败会无限退避重试，没有人工处理面板。
3. 固定 Demo Repository 和一键启动/验收脚本，执行连续两轮 Create/Approval/Artifact 演示。
4. 整理架构图、README、面试讲解稿和简历项目描述。

### 2026-08-12 / progress-v0.9

- 完成 Runtime Event SQLite Persistent Outbox。
- 完成至少一次投递、带抖动指数退避、同 Run 顺序屏障和进程重启恢复。
- 新增 4 个 Outbox/Reporter 测试，相关定向回归 11/11 通过。
- TypeScript 类型检查、生产构建和 lint 通过；记录既有 Windows 路径基线失败。

## 23. Runtime 配置预检与 Outbox 健康指标（2026-08-12 / progress-v0.10）

### 23.1 Start 配置预检

- 正式 Agent Start 在创建 `runtimeRunId`、写入命令幂等记录和启动 Provider 前检查事件回传配置。
- 缺少 `ZHISHU_CONTROL_BASE_URL`、缺少 `ZS_RUNTIME_TOKEN`，或回调地址不是合法 HTTP(S) URL 时返回：

```json
{
  "code": "RUNTIME_EVENT_DELIVERY_NOT_READY",
  "message": "Runtime event delivery is not configured for formal Agent tasks.",
  "details": {
    "missingConfiguration": ["ZHISHU_CONTROL_BASE_URL"],
    "invalidConfiguration": []
  }
}
```

- HTTP 状态为 503，Provider 不会启动，也不会创建一个注定缺少事件的 Node Run。
- 响应只包含配置项名称，不返回令牌值。
- 普通 Chat 不经过该 Start 接口，仍保持不依赖 Spring 的原架构边界。

### 23.2 健康与可观测性

- 新增受 Runtime Bearer Token 保护的 `GET /internal/runtime/v1/health`。
- Node 公共 `/health` 增加 `runtimeEventDelivery` 子快照，但整体 `status` 仍反映 Node/普通 Chat 服务本身。
- 快照字段：
  - `status`: `up` / `degraded` / `misconfigured`
  - `started`、`configurationReady`
  - `missingConfiguration`、`invalidConfiguration`
  - `pendingEvents`、`dueEvents`
  - `oldestEventAgeMs`、`maxAttempts`、`lastError`
- SQLite 使用单条聚合查询计算 pending、due、最早创建时间、最大失败次数与最近错误。
- 新事件短暂 pending 但从未失败时仍为 `up`；存在失败重试为 `degraded`；配置缺失或非法为 `misconfigured`。

### 23.3 契约与验证

- Runtime OpenAPI 新增 `/health` 与 `RuntimeEventDeliveryHealth` schema，并声明 Start 503。
- `.env.example` 更新正式任务预检与 Outbox 恢复语义。
- Runtime 协议文档同步预检、健康接口和普通 Chat 隔离边界。
- 新增覆盖：SQLite 聚合统计、配置缺失/非法、健康状态、503 快返、内部认证和秘密不泄漏。
- 本轮 Runtime/Outbox 定向回归：18/18 通过。
- Runtime OpenAPI YAML 解析通过。
- 编译产物真实启动冒烟通过：公共 `/health` 与受保护 `/internal/runtime/v1/health` 均返回 `up`、配置就绪、Reporter 已启动且 pending 为 0。

### 23.4 下一阶段

1. 固定一个最小 Demo Repository，准备只读、审批写入、测试和 Artifact 四步任务模板。
2. 编写一键启动与一键验收脚本，自动检查 Java 21、Docker、PostgreSQL、共享令牌、Spring/Node health。
3. 连续执行两轮稳定 Demo，保留事件、Artifact、截图和测试报告。
4. 整理最终架构图、README、面试讲解稿和简历项目描述。

### 2026-08-12 / progress-v0.10

- 完成正式 Agent Start 配置预检，错误配置在 Provider 启动前以 503 快速失败。
- 完成 Outbox pending/due/age/attempts/error 聚合指标和三态健康判断。
- 新增受保护 Runtime health，并在公共 Node health 中嵌入秘密脱敏快照。
- 同步 OpenAPI、环境变量示例和 Runtime 协议文档。
- 相关定向回归 18/18 通过。

## 24. 固定 Demo Repository 与一键验收（2026-08-12 / progress-v0.11）

### 24.1 固定最小仓库与四步任务

- 新增独立 `demo-repository`，业务规则固定为折扣率限制在 `0..0.5`。
- 模板基线故意保留负折扣和超上限折扣两个缺陷：运行三项测试时固定为 1 通过、2 失败。
- 每轮验收复制全新隔离工作区，Agent 修改不会污染模板，也不会依赖上一轮遗留文件。
- `tasks.json` 固定四步契约：
  1. 只读定位边界缺陷，要求 `SUMMARY`；
  2. 经审批修改唯一源文件，要求至少一次审批、`FILE_CHANGE` 与 `SUMMARY`；
  3. 经审批执行 `npm test`，要求至少一次审批、`TEST_REPORT` 与 `SUMMARY`；
  4. 只读生成最终交付总结，要求 `SUMMARY`。

### 24.2 一键工程脚本

- `npm run demo:check`：检查 Node.js 22、npm、JDK 21、Maven、Docker CLI/daemon/Compose、Claude Code CLI、Node 依赖和 Demo 夹具。
- JDK 自动发现会优先寻找 Java 21，不受本机全局 `JAVA_HOME` 指向旧 Java 的影响。
- `npm run demo:start`：构建 Node/Spring，启动并等待 PostgreSQL、Spring、Node 公共 health 与受保护 Runtime health。
- 若未配置共享令牌，生成 256-bit 临时令牌；值只进入被 Git 忽略的状态文件，控制台不会输出秘密。
- `npm run demo:verify`：登记 Project/Profile、顺序创建四个真实 AgentTask、仅批准本轮任务的待审批项、等待终态并校验事件与 Artifact。
- `npm run demo:stop`：只停止状态文件记录的 Node/Spring PID；PostgreSQL 仅在脚本本轮启动时停止，数据卷保留。
- 支持 `--node-port`、`--control-port` 和 `--skip-build`，可避开现有开发服务并缩短重复演示准备时间。

### 24.3 真实连续两轮验收

- 因 3001 已有用户服务，本轮使用隔离端口 Node 3012 / Spring 8082；原服务未被停止或复用。
- 第一轮：4/4 Task 均 `SUCCEEDED`，审批数 `0/1/2/0`，最终测试 3/3 通过。
- 第二轮：4/4 Task 均 `SUCCEEDED`，审批数 `0/1/1/0`，最终测试 3/3 通过。
- 两轮均观察到 `Edit` 或 `Bash` 的 `APPROVAL_REQUIRED -> APPROVAL_RESOLVED`，真实 Claude 工具在 Spring 审批后恢复。
- 两轮写入任务均产生 `FILE_CHANGE`，测试任务均产生 `TEST_REPORT`，八个任务均产生 `SUMMARY`。
- 验收器从 SSE 初始游标重放耐久事件，校验 sequence 严格递增并观察终态事件。
- 每轮生成 JSON 原始证据和 Markdown 人读报告，保存于 `.zhishu-demo/evidence`；运行期目录整体不提交 Git。
- 自动停止验证通过：3012/8082 释放；脚本未启动的 PostgreSQL 保持运行；原有 3001 `/health` 仍为 `ok`。

### 24.4 自动化验证

- Demo 脚本单元测试：5/5 通过。
- 环境预检：11/11 通过。
- 固定夹具基线：预期 1/3 通过、2/3 失败，证明修复前缺陷真实存在。
- 完整真实 Demo：连续两轮、共 8/8 Task 成功，最终测试两轮均 3/3 通过。
- Control Plane Maven/Testcontainers 完整回归：20/20 通过。
- `npm run typecheck` 与生产构建通过；`npm run lint` 为 0 errors、222 个仓库既有 warnings。
- 所有新增 `.mjs` 语法检查和 `git diff --check` 通过；仅保留仓库既有 LF/CRLF 提示。

### 24.5 下一阶段

1. 输出最终架构图、关键时序图和模块职责说明，形成 README 主入口。
2. 整理 3 分钟/10 分钟两套面试讲解稿和故障复盘问答。
3. 生成可直接投递的简历项目描述、技术亮点与量化指标。
4. 后续加分项：Approval Timeout、SSE heartbeat、Artifact 文件下载与人工死信处理。

### 2026-08-12 / progress-v0.11

- 建立固定最小 Demo 仓库和只读、审批写入、审批测试、Artifact 总结四步任务模板。
- 完成跨平台环境预检、一键启动、一键验收和安全停止脚本。
- 连续两轮真实 Claude + PostgreSQL + Spring + Node 验收通过，共 8/8 Task 成功。
- 保存两轮完整任务、审批、耐久事件、Artifact 与最终测试证据。

## 25. README、架构与招聘材料（2026-08-12 / progress-v0.12）

### 25.1 项目入口与真实性边界

- 在英文和中文根 README 顶部增加知枢入口，同时完整保留上游 CloudCLI 说明和来源。
- 新增 `docs/zhishu-project.md`，用问题、架构、核心能力、真实指标、截图和当前边界建立招聘方阅读主线。
- 明确表述：正式 AgentTask 当前真实验证 Claude Executor；普通 Chat 的其他 Provider 能力不等同于正式 Task 多 Executor。
- 明确区分上游能力与本项目新增内容，避免“从零重写 Agent/IDE”等不准确表述。

### 25.2 架构与时序材料

- 新增 `docs/architecture.md`，包含总体架构、模块职责、数据所有权和安全/故障边界。
- 使用 Mermaid 固化 Task/Attempt 状态机、创建任务/事件回传、Approval、Outbox/幂等关键关系。
- 强调 Java/Node 数据库所有权分离、202/STARTING 语义、At-Least-Once 而非 Exactly-Once、同 Run FIFO 和当前无 Lease/Heartbeat 的边界。

### 25.3 面试与简历材料

- 新增 `docs/interview-guide.md`，包含 3 分钟和 10 分钟讲解稿、演示顺序、18 个高频追问与回答、容易说错的能力边界。
- 新增 `docs/resume-project.md`，提供一页简历精简版、Java 后端版、Agent 工程版、系统设计亮点、30 秒介绍和 STAR 复盘素材。
- 所有量化数字只使用真实验证结果：两轮 8/8 Task、两轮测试 3/3、Java 20/20、Runtime/Outbox 18/18、Demo 5/5、预检 11/11。
- Reliability Bonus 只写已完成的 Outbox、At-Least-Once、顺序屏障、重启补报和健康指标，不把 Heartbeat/Lease 写成已实现。

### 25.4 可提交证据

- 新增 `docs/demo-evidence.md`，以脱敏形式固化两轮任务状态、审批计数、Artifact、测试、停止和隔离结果。
- 完整运行时 JSON/Markdown 仍保存在 `.zhishu-demo/evidence` 且被 Git 忽略，避免把临时共享令牌或本机运行状态提交到仓库。
- 项目总览复用现有 Playwright 截图展示创建/SSE、Approval 和 Artifact，不伪造界面证据。

### 25.5 后续项

1. 投递前根据 Java 后端或 Agent 工程岗位，从简历材料中选择 3–4 条，不整页照搬。
2. 用 3 分钟讲稿完成至少三次录音演练，确保能脱稿说明 Task/Attempt、202/STARTING 和 At-Least-Once。
3. 保留一轮预先生成的脱敏报告，现场 Demo 失败时仍能讲完整链路和故障语义。
4. 功能增强仍按优先级：Heartbeat/Lease、Approval Timeout、Artifact 文件下载、Outbox 人工死信处置。

### 2026-08-12 / progress-v0.12

- 完成中英文 README 知枢入口、项目总览和最终系统架构文档。
- 完成 3/10 分钟面试讲稿、18 个高频追问和演示讲解顺序。
- 完成多岗位简历描述、量化指标、职责边界与 STAR 复盘素材。
- 完成可提交脱敏 Demo 证据，并保持运行时秘密目录不进入 Git。

## 26. 产品化一键启动与后续路线（2026-08-12 / progress-v0.13）

### 26.1 一键启动入口

- Windows 根目录增加 `start.bat` / `stop.bat`，双击即可启动、打开浏览器或安全停止。
- macOS / Linux 根目录增加 `start.sh` / `stop.sh`；npm 增加 `zhishu:start` / `zhishu:stop` 跨平台入口。
- 启动器构建前注入实际 Control Plane 地址，支持自定义端口时前端仍访问正确后端。
- 默认地址已有完整健康栈时直接复用；只存在半套服务、健康异常或端口被无关程序占用时明确失败，避免混合不同共享令牌的 Node/Spring。
- 停止器使用状态文件 PID 与进程入口命令双重校验，不再按端口误杀其他本机服务；PostgreSQL 数据卷始终保留。

### 26.2 后续工作排序

- P0：Runtime Heartbeat/Lease 与失联终态、Approval Timeout。
- P1：Artifact 文件下载与保留策略、Outbox 死信处置、认证/RBAC/审计。
- P2：多 Worker 调度、正式多 Executor、OpenTelemetry；不为简历展示提前堆 Redis/MQ/Kubernetes。
- 详细取舍与验收方向记录在 `docs/improvement-roadmap.md`。

### 26.3 验证结果

- Windows 首次完整生产构建与启动通过；重复启动完成 PID 归属和三项 health 校验后直接复用。
- Windows `start.bat` / `stop.bat` 真实调用通过；批处理控制文本使用 ASCII，兼容中文项目路径下的传统 `cmd.exe`。
- 停止验证确认：状态文件删除、3001/8080 释放、启动器未拥有的 PostgreSQL 保持运行。
- Demo 脚本单测更新为 7/7 通过，环境预检仍为 11/11 通过；`.mjs` 语法检查通过。

### 2026-08-12 / progress-v0.13

- 完成面向使用者的 Windows/macOS/Linux 一键启动和安全停止入口。
- 完成已有服务复用、端口占用诊断和启动后自动打开浏览器。
- 固化后续完善优先级，当前版本进入“可靠性补强与求职表达”阶段。

## 27. OpenCode 模型恢复与新会话 Provider 收敛（2026-08-12 / progress-v0.14）

- 定位 OpenCode 无模型根因为旧版/测试伪 Catalog 被三天磁盘缓存命中，并非 OpenCode CLI 未安装或未登录。
- 升级 Provider Model Cache 格式，自动淘汰旧的 `opencode-models` 伪条目并重新读取 `opencode models --verbose`。
- 注入测试 Provider 默认改为纯内存缓存，杜绝单测把 stub Catalog 写入用户 `~/.cloudcli`。
- 前端 Provider 模型请求按 Provider 隔离；单个 CLI/接口失败不再连带清空其他成功 Catalog。
- 新会话模型选择器隐藏 Cursor，旧 Cursor 会话仍由原 Provider 链路正常读取；从旧会话返回新建页时自动回退 Claude。
- OpenCode/缓存定向回归、前后端 TypeScript 类型检查和触及文件 ESLint 均通过。

## 28. Windows 冷启动自愈（2026-08-13 / progress-v0.15）

- 复现一键启动失败：重启/隔夜后 Docker Desktop daemon 未运行，PostgreSQL 无法启动；同时遗留状态文件仍指向已退出 PID。
- Windows 一键启动在 daemon 不可用时自动定位并启动 Docker Desktop，等待最多 120 秒后继续环境检查。
- Node/Spring PID 均已退出时自动删除失效状态文件，不再要求用户手工清理。
- `start.bat` 改由独立 PowerShell 启动器承载，控制台成功或失败都等待用户按回车，不再闪退。
- 启动全过程同步写入 `.zhishu-demo/logs/launcher-latest.log`，失败提示直接给出日志位置。
- 在 Docker daemon 关闭、端口全空、旧状态残留的真实现场完成冷启动：Docker/PostgreSQL/Spring/Node 全部就绪，Node `ok`、Runtime `up`、Spring `UP`、PostgreSQL `healthy`。

## 29. Agent Task Center 人类可读重构（2026-08-13 / progress-v0.16）

- 用“修复问题、只读审查、补充测试、故障排查”四类明确模板替代含糊的默认验证任务，修复模板明确禁止无关的颜色、格式和重命名改动。
- 增加“当前进度”摘要，直接说明 Agent 正在做什么、是否等待用户，以及任务结束后是否存在未执行操作。
- 审批区域把 `Edit`、`Write`、`Bash` 参数翻译为文件目标、修改前后对比和待执行命令；原始 JSON 收进可展开的技术细节，操作按钮改为“允许并继续/拒绝本次操作”。
- Artifact 按类型、内容和 Attempt 合并重复项；`Permission request timed out` 改为“审批等待超时”，明确说明它不是代码错误，而是操作在超时前未获允许、因此没有执行。
- 执行时间线改为“Agent 做了什么”，过滤 `token_budget` 等内部噪音、合并连续重复事件，并将启动、工具调用、审批、命令、产物和结束状态转换为中文步骤；原始事件仅在用户主动勾选后显示。
- 使用当前真实任务的 89 条持久化事件和 5 条审批超时产物核对语义；触及文件 ESLint、`git diff --check` 和前后端生产构建全部通过。

## 30. 多执行器与轻量 CC Switch 方案（2026-08-13 / progress-v0.17）

- 完成 Claude Code、Codex、OpenCode 三类执行器与官方 API、DeepSeek、中转站等模型线路的可行性审计。
- 确认现有 Provider Registry、三套 Runtime Adapter、Runtime Start 协议以及 `agent_profile.executor/model_alias` 可以复用；正式 Agent 当前主要受 Node Claude-only 校验、Spring 单一执行器枚举和 Provider 专用审批映射限制。
- 明确“执行器、模型线路、模型”三层概念，设计 Runtime Connection、Agent Profile 和 Attempt 配置快照的职责边界。
- 发现现有通用凭据表明文保存 `credential_value`，将系统安全凭据存储、日志脱敏和任务级环境注入列为 Phase 0 前置条件。
- 输出 `docs/multi-executor-provider-switch-plan.md`，覆盖目标架构、API 草案、数据模型、执行器兼容矩阵、安全要求、迁移回滚、测试计划、验收标准与 12～20 天完整建设评估。
- 确定实施顺序：Claude Code 轻量 CC Switch → Codex 正式执行与网页审批 → OpenCode 只读执行与完整审批。

## 31. Claude CC Switch 与多执行器开关（2026-08-13 / progress-v0.18）
### 31.1 Claude Code 轻量 CC Switch
- 新增 Node 本地 `runtime_connections` SQLite 表：线路 CRUD、连接测试、启用/禁用。
- API Key 使用 AES-256-GCM 加密保存，密钥默认位于 ~/.cloudcli/runtime-connections.key，可用 ZHISHU_CONNECTION_ENCRYPTION_KEY 覆盖；密文与密钥分离，不回填前端。
- 新增线路健康状态：可用、认证失败、限流、不可达、服务端错误、凭据错误、未检查，记录 HTTP 状态码、延迟与最后检查时间；探测失败也持久化。
- 支持 API Key 轮换：运行中 Attempt 保持启动时环境，新任务使用新密钥。
- 设置页新增“模型线路”，Agent Task Center 创建任务可选线路。
- Runtime Protocol v1 增加可选 connectionRef；Claude SDK 使用每次 Run 独立的 options.env 注入 ANTHROPIC_BASE_URL、认证变量与默认模型，不改全局 process.env。
- Spring `agent_profile` 增加 connection_ref（Flyway V3，不修改已发布 V1/V2）；AgentProfileSnapshot、Attempt 快照、Runtime Start 命令均包含线路引用；Attempt 查询返回 executor/modelAlias/connectionRef。
- 删除保护：运行中 Attempt 使用中的线路删除返回 409 RUNTIME_CONNECTION_IN_USE。
- 新增数据库集成测试覆盖健康持久化、密钥轮换和密钥不泄露。
### 31.2 多执行器开关（Claude / Codex / OpenCode）
- Spring ExecutorType 增加 CODEX、OPENCODE，并增加 @JsonValue/@JsonCreator 使快照 JSON 使用线值 claude/codex/opencode（兼容读取旧 CLAUDE 存量数据）。
- 任务创建支持单次 executor 覆盖并写入 Attempt 快照；Profile 默认线路保留，非 Claude 执行器自动忽略 connectionRef。
- Node Runtime 移除 Claude-only 硬校验：支持 claude/codex/opencode 分发，Cursor 与未知执行器返回 422 UNSUPPORTED_EXECUTOR；非 Claude 携带 connectionRef 返回 422 CONNECTION_EXECUTOR_MISMATCH。
- 只读任务（无 WRITE_FILE/SHELL/GIT/TEST）以 plan 模式执行：Codex sandboxMode: read-only、OpenCode --agent plan；写任务保持 default，等审批接入后再开放。
- Codex/OpenCode 事件经现有 normalizeMessage 归一为统一事件；取消按执行器记录 provider-native session id 后 abort。
- Agent Task Center 增加执行器下拉（Claude Code / Codex / OpenCode），非 Claude 隐藏线路选择；任务详情展示真实执行器/模型/线路。
### 31.3 验证结果
- 新增 Node 运行时测试 6 项（codex/opencode 分发、plan 权限模式、非法执行器 422、connectionRef 不匹配 422、按 provider-native id 取消）；Runtime 模块 23/23 通过。
- Java 回归 20/20 通过（使用 JDK 21；历史 Maven 报错系 JAVA_HOME 指向 JDK 1.8 导致，非代码语法问题；集成测试 Flyway 计数随 V3 更新为 3）。
- 前后端 TypeScript、触及文件 ESLint、git diff --check、npm run build 全部通过。
- 未提交；不执行 Git 提交。

## 32. 任务验收、跟进与 Attempt 历史（2026-08-14 / progress-v0.19）

### 32.1 执行状态与解决状态

- 保留 `AttemptStatus` 作为单次执行状态，新增任务级 `ResolutionStatus`：`OPEN / IN_PROGRESS / WAITING_ACCEPTANCE / NEEDS_FOLLOW_UP / RESOLVED / CLOSED`。
- Task API 同时返回 `attemptStatus` 与 `resolutionStatus`；旧 `status` 仅作为兼容别名保留。
- Runtime 成功事件只把任务推进到 `WAITING_ACCEPTANCE`，不再把 Agent 正常退出等同于问题已解决。
- 验收支持已解决、需要跟进、关闭任务；每次决定追加记录 actor、decision、reason、attemptId、clientRequestId 和时间。

### 32.2 Follow-up 与历史

- 新增 `POST/GET /api/v1/tasks/{taskId}/follow-ups` 与 `POST /api/v1/tasks/{taskId}/acceptance`。
- Follow-up 在同一 taskId 下创建独立 Attempt，保存 parentAttemptId/followUpId，并通过事务和客户端请求 ID 防止重复创建。
- 新 Attempt 使用上一次 Attempt 的执行器配置快照，并向 Runtime 传递 `TASK_FOLLOW_UP_V1` 结构化上下文：原目标、上次状态和失败原因、摘要/文件变更/测试证据、用户反馈、新验收要求和补充上下文。
- Task Center 增加解决状态、待验收操作、应用内跟进/验收 Dialog 和可选择的 Attempt 历史；事件和产物按所选 Attempt 展示。

### 32.3 数据库与验证

- Flyway V4 新增 `agent_task.resolution_status/resolution_version`、`task_acceptance_audit`、`task_follow_up` 及幂等唯一约束和查询索引。
- JDK 21 `mvn test`：28/28 通过。
- Testcontainers 实际启动 PostgreSQL 16 并执行 Flyway V1-V4；覆盖验收审计、重复请求、Follow-up Attempt #2、运行中拒绝跟进、历史事件/产物保留和结构化 Runtime 上下文。
- `npm run typecheck`、全量 ESLint（0 errors，222 个既有 warnings）和 `npm run build` 通过；构建仍报告项目既有 CSS 语法和大 chunk 警告。
- 未实现自动审批；未提交 Git。

## 33. 自动审批策略（2026-08-14 / progress-v0.20）

### 33.1 策略与双层校验

- 增加 `MANUAL / AUTO_SAFE / AUTO_TRUSTED`，项目策略和任务请求冲突时取更严格模式，并把有效策略冻结到每个 Attempt。
- 项目策略支持相对目录和精确 argv 命令白名单；`AUTO_SAFE` 放行项目内读/搜索与内置精确测试、lint、构建命令，`AUTO_TRUSTED` 再放行配置的精确命令。
- Control Plane 和 Node Runtime 使用等价规则独立校验；Node 保留原始 tool name/input，并在 provider 最终放行前再次评估。
- 项目外路径、凭证文件、危险删除/系统命令、shell 组合符和网络上传始终拒绝，人工批准也不能覆盖硬性禁令。

### 33.2 审计、超时与界面

- 自动批准、策略拒绝、人工决定和超时拒绝都记录 decision source、policy、rule、reason，并写入 `approval_audit`。
- 审批过期由定时扫描默认拒绝；Runtime 时间线记录 `AUTO_APPROVED / DENIED / EXPIRED` 和具体规则。
- 新增项目审批策略 GET/PUT API；任务中心增加任务审批模式、项目策略 Dialog、Attempt 模式和“已按规则自动批准”时间线。

### 33.3 数据库与验证

- Flyway V5 新增 `project_approval_policy`、Attempt 策略快照、审批决策元数据、`approval_audit` 和超时查询索引。
- JDK 21 单元与 PostgreSQL 16 Testcontainers 集成测试覆盖 V1-V5、项目策略 API、自动审批审计和超时默认拒绝。
- Node Runtime 测试使用真实临时项目覆盖项目内读取、精确命令、前缀不匹配、项目外路径、凭证、删除、上传和 Runtime 更严格规则。
- 未提交 Git。
