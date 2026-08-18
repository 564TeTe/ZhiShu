# 知枢面试讲解稿

## 1. 开场一句话

> 我基于开源 CloudCLI 做了一个 Coding Agent 编排平台。没有重新实现 Claude Code，而是把原来的 Node Agent Runtime 作为 Execution Plane，再用 Spring Boot 建立 Control Plane，解决正式研发任务的状态、审批、重试、事件可靠性和结果归档问题。

这句话先交代三件事：基于什么、自己做了什么、工程难点是什么。不要把项目说成“从零实现 Claude Code”，也不要只说“接入大模型 API”。

## 2. 三分钟版本

### 0:00–0:35：问题

CloudCLI 原本已经能让用户和 Claude/Codex 对话，但一次 Agent 执行仍像即时聊天：没有正式 Task、失败后没有独立 Attempt、危险工具缺少业务侧审批、跨进程事件失败后可能丢失，最终结果也不方便验收。

### 0:35–1:15：架构

我的设计是 Control Plane / Execution Plane 分离：

- 普通 Chat 仍走 React → Node → Provider，保持低延迟；
- 正式 AgentTask 走 React → Spring Boot → Node → Claude；
- Spring 管 Task/Attempt、状态机、Approval、Cancel/Retry、Event、Artifact 和 SSE；
- Node 管 Prompt Assembly、Capability 到 Tool 的映射、真实 Agent 执行以及 SQLite 命令去重和事件 Outbox。

Java 和 Node 不共享数据库，只通过版本化 Runtime Protocol 和 `taskId / attemptId / runtimeRunId` 关联。

### 1:15–2:20：三个难点

第一是异步状态一致性。Node 返回 202 只能说明接受命令，所以 Attempt 先进入 STARTING，收到 `RUN_STARTED` 才进入 RUNNING；Retry 创建新 Attempt，不覆盖旧历史。

第二是工具审批。Claude 请求 Edit 或 Bash 时，Node Permission Hook 注册 pending Promise 并回传 `APPROVAL_REQUIRED`；Spring 持久化审批并推给前端，用户决策后回调 Node，才 resolve 或拒绝该 Tool。迟到审批和 Cancel 竞争时返回冲突，不恢复已经结束的 Run。

第三是可靠事件。Node 先把 RuntimeEvent 写入 SQLite Outbox，再异步投递；失败后指数退避，同一 Run 保证顺序，重启后继续扫描。Spring 用 `event_id` 和 `(attempt_id, sequence_no)` 两个唯一约束精确去重，因此整体是 At-Least-Once 而不是假装 Exactly-Once。

### 2:20–3:00：结果与边界

我做了固定 Demo Repository 和一键验收，连续跑了两轮真实 Claude，每轮包含只读分析、审批写入、审批测试和 Artifact 总结，共 8/8 个 Task 成功；两轮最终测试都是 3/3。Control Plane Maven/Testcontainers 20/20 通过，Runtime/Outbox 定向回归 18/18。

当前是单机黄金版，正式 Task 只验证 Claude Executor。Heartbeat/Lease、多 Worker 调度、Artifact 文件存储是下一步，而不是在简历里提前写成已完成。

## 3. 十分钟版本

### 第 1 分钟：项目来源与个人工作

- 上游 CloudCLI 提供 React UI、Node Provider、聊天、文件、Shell、Git 等能力。
- 我的重点是把它从“能调用 Agent”扩展成“能治理正式研发任务”。
- 新增 Spring Boot Control Plane、PostgreSQL 领域模型、Runtime Protocol、Task Center、命令幂等、Persistent Outbox、健康预检和固定 Demo。

推荐原话：

> 我主动保留了成熟执行层，没有为了体现工作量重复造 Agent Runtime。我的工作量集中在跨语言编排、状态一致性、权限治理和可验证交付上。

### 第 2–3 分钟：两条路径与领域模型

先画两条路径：

```text
普通 Chat：React ↔ Node ↔ Provider
正式 Task：React ↔ Spring ↔ Node ↔ Provider
```

解释 Task / Attempt：

- Task 表示稳定的业务目标；
- Attempt 表示一次具体执行；
- Profile Snapshot 在 Attempt 创建时冻结 Executor、Capability 和权限策略；
- Retry 创建 Attempt N+1，因此错误、事件和 Artifact 都能按执行轮次追溯。

强调 `202 Accepted ≠ Agent 已运行`：这是为什么存在 STARTING，而不是创建后直接 RUNNING。

### 第 3–4 分钟：Runtime Protocol 与事务边界

Spring 先提交 PENDING Attempt，再跨 HTTP 调 Node，避免数据库事务跨越网络边界。Start 命令包含协议版本、幂等键、Task/Attempt 标识、工作区、目标、Capability、Permission Policy 和上下文。

Node 在启动 Provider 前完成：

1. Executor 和工作区校验；
2. 回调配置预检；
3. `idempotencyKey + semantic hash` 持久化判重；
4. 创建 runtimeRunId 并异步启动 Provider。

如果 Spring 请求超时后重试，相同 key + 相同语义返回第一次响应；相同 key + 不同语义返回 409，避免静默复用错误命令。

### 第 4–5 分钟：状态与事件投影

Provider 消息被转换为强类型 RuntimeEvent。Spring 先幂等入库，再按事件投影 Attempt、Approval 和 Artifact；SSE 只发布已提交事件。

重点解释两个竞态：

- Node 回调可能比 Spring 保存 `runtimeRunId` 更快：事件先持久化，随后由 Deferred Reconcile 再投影；
- SSE 断线不是丢事件：前端重连携带 Last-Event-ID，Spring 从 PostgreSQL 补历史后继续推新事件。

### 第 5–6 分钟：Approval

Capability 是业务抽象，如 WRITE_FILE、SHELL、TEST；Node 再映射成 Claude Tool，如 Edit、Write、Bash。需要审批的 Tool 不进入 auto-allow 列表，而进入 ask 列表。

Permission Hook 收到请求时先注册 pending Promise，再生成事件。Spring 保存 Approval 并驱动 WAITING_APPROVAL；决策回调到 Node 后校验 Run 和 approvalId 仍有效，然后恢复 Tool。

Cancel 先赢时，Run 进入取消/终态并清空 pending approval；迟到 decision 返回 409。这一安全默认值比“晚到的批准仍执行”更合理。

### 第 6–7 分钟：可靠性

Node 不能在 Spring 暂时不可用时直接丢事件，所以采用本地 SQLite Outbox：

- 先持久化、后 HTTP；
- 2xx 后删除；失败记录次数、错误和下次时间；
- 带抖动指数退避；
- 同 Run 以前序 sequence 为屏障，不让后序越过；
- 不同 Run 独立推进；
- Node 重启后继续扫描。

Spring 通过两个唯一约束吸收重复投递。明确说它是 At-Least-Once；“网络超时但服务端已成功”时仍可能重发，Exactly-Once 在这里不成立。

### 第 7–8 分钟：Artifact 与前端

Task Center 提供任务列表、时间线、审批、Cancel、Retry 和 Artifact 筛选。Node 根据消息和工具结果提取五类 Artifact：Summary、File Change、Git Diff、Test Report、Error Report；Spring 按 Task/Attempt 归档，前端展示生产者、时间、命令、哈希和内容。

Artifact 的价值不是多一个 UI 卡片，而是把“模型说完成了”转换成可以查询、复核和归属到 Attempt 的交付证据。

### 第 8–9 分钟：测试与 Demo

测试分层：

- Node：Runtime Service、Route、Command Dedup、SQLite Outbox、Reporter；
- Java：状态机、Orchestrator、Approval、Event Projector、Repository；
- Testcontainers：真实 PostgreSQL + Flyway + 唯一约束与投影；
- 浏览器：Task Center 的创建/SSE、审批、取消、Artifact；
- 固定 Demo：真实 Claude 修改隔离仓库、审批运行测试并校验最终结果。

量化结果只说真实数据：两轮 8/8 Task、最终测试两轮 3/3、Java 20/20、Runtime/Outbox 18/18。

### 第 9–10 分钟：取舍与演进

单机黄金版没有引入 Redis、MQ、微服务和 K8s，因为当前规模下 PostgreSQL + SQLite Outbox 已能清晰表达事务、幂等和故障语义，额外中间件只增加运维面。

生产演进顺序：

1. Heartbeat/Lease 和 RUNTIME_LOST；
2. Approval Timeout 与自动拒绝；
3. Worker Registry + 调度/限流；
4. Artifact 对象存储、下载和保留策略；
5. Outbox 死信处置、告警和指标系统；
6. 再根据吞吐量决定是否引入消息队列。

## 4. 高频追问与回答

### Q1：CloudCLI 已经能调用 Agent，为什么还需要 Spring Boot？

Node 擅长承接 Provider SDK 和工具执行，但正式任务还需要稳定业务模型、事务、状态机、审批、查询、历史和权限边界。Spring 不是为了“再转发一次 HTTP”，而是作为任务治理的事实来源。普通 Chat 不需要这些语义，所以仍绕过 Spring。

### Q2：为什么 Task 和 Attempt 不合成一张表？

Task 是用户目标，Attempt 是一次执行。Retry 如果覆盖原记录，就无法解释第一次为何失败、第二次用了什么策略、Artifact 属于哪次执行。拆分后 Task 保持稳定，Attempt 追加历史，并能冻结 Profile Snapshot。

### Q3：Node 返回 202 后为什么不直接 RUNNING？

202 只证明命令被接受，不证明 Provider 已启动。如果直接 RUNNING，Node 在异步启动前崩溃会产生假运行状态。收到 `RUN_STARTED` 才说明真实 Executor 已进入运行阶段。

### Q4：Spring 先存 Attempt 还是先请求 Node？

先持久化 PENDING Attempt，再跨网络请求 Node。这样即使网络失败也有审计记录，并且不把数据库事务跨到不可靠的 HTTP 边界。Node 接受后更新 STARTING；失败则标记 FAILED。

### Q5：请求超时后重试为什么不会启动两个 Agent？

Start 使用持久化 idempotencyKey。Node 对命令做稳定语义哈希：key 和 hash 都相同则重放原 response；key 相同但 hash 不同则 409。去重记录在 SQLite，Node 重启后仍有效。

### Q6：事件为什么不能 Node 直接 POST，失败就打印日志？

任务终态、审批和 Artifact 都依赖事件。直接 POST 在 Spring 重启或网络抖动时会永久丢状态。Outbox 把事件生成和网络投递解耦，恢复后补报；健康快照还能暴露积压和最大重试次数。

### Q7：你实现了 Exactly-Once 吗？

没有，也不应该这样表述。Node 是 At-Least-Once，超时后允许重发；Spring 用 eventId 和 Attempt/sequence 唯一约束实现幂等效果。端到端 Exactly-Once 在网络边界上通常不现实。

### Q8：同一 Attempt 的事件会乱序吗？

Node 为每个 Run 单调递增 sequenceNo；Outbox 查询只释放不存在未完成前序的记录，因此前序失败会阻挡同 Run 后序。Spring 再用 `(attempt_id, sequence_no)` 约束检测冲突。不同 Run 不互相阻塞。

### Q9：为什么前端用 SSE，不用 WebSocket？

任务事件主要是服务端单向推送，客户端控制操作本来就走 REST。SSE 原生支持事件 ID、自动重连，并且 Last-Event-ID 很适合从 PostgreSQL 补历史。普通 Chat 的双向流仍使用 WebSocket，两者各自匹配场景。

### Q10：Approval 怎么真正阻止 Tool？

不是先执行再弹通知。Node 的 Provider Permission Hook 在 Tool 执行前返回一个 pending Promise；决策未到达时 Tool 不继续。Spring 决策回调后 Node 才 resolve allow 或 deny。真实 Demo 已观察到 Edit/Bash 的暂停与恢复。

### Q11：Cancel 和 Approve 同时到达怎么办？

Node 对 Run 终态和 pendingApprovalIds 做校验。Cancel 先完成时 pending approval 被清除，迟到 decision 返回 409；Decision 先完成时 Tool 恢复，随后 Cancel 仍可中止 Run。安全关键是迟到批准不能复活终态操作。

### Q12：为什么 Java 和 Node 不共用 PostgreSQL？

数据库所有权清晰：Spring 保存业务事实，Node 保存执行侧幂等和 Outbox。共享表会让两种技术栈通过隐式 schema 耦合，绕开 API 不变量，也提高独立演进和故障定位成本。

### Q13：为什么没用 Kafka/RabbitMQ？

单机演示的生产者就在 Node 本地，SQLite Outbox 足以提供持久化、重试和顺序语义；消费侧又需要 PostgreSQL 事务投影。先把语义做对比提前引入 MQ 更重要。多 Worker 或更高吞吐出现后，才有真实理由引入 Broker。

### Q14：Spring 在事件到达前还没保存 runtimeRunId 怎么办？

这是 HTTP 接受竞态。事件先按 Task/Attempt 幂等落库，即使暂时不能完整投影也不丢；Spring 保存 acceptance 后执行 reconcile，再处理未投影事件。

### Q15：基于开源项目，你自己的贡献是什么？

应主动说明边界：上游提供 UI、聊天、Provider、文件/Shell/Git 等底座；我设计并实现了 Spring Control Plane、领域表和状态机、Runtime Protocol、任务中心、Approval/Cancel/Retry、事件投影与 SSE、Artifact、Node 命令幂等和 Persistent Outbox，以及固定 Demo 和测试体系。

### Q16：当前最大的未解决问题是什么？

没有 Heartbeat/Lease，所以 Node 进程或 Provider 子进程崩溃后，Spring 还不能自动把长时间运行的 Attempt 判为 RUNTIME_LOST。其次是 Approval Timeout、Artifact 文件存储和多 Worker 调度。这些应作为明确演进项，而不是隐藏。

### Q17：为什么正式 Task 只做 Claude？

黄金版优先把一个 Executor 的状态、审批、可靠性和 E2E 做完整。Runtime Protocol 已隔离 Provider 细节，但不同 SDK 的权限 Hook、取消和事件形态不同；没有完成适配和真实验证前，不把普通 Chat 的多 Provider 能力等同于正式 Task 多 Executor。

### Q18：如果上线生产，你先改什么？

先加 Lease/Heartbeat、Approval Timeout、指标告警和 Outbox 人工处置，再做 Worker Registry 与调度。安全上引入外部 Secret 管理和更细权限审计；Artifact 迁移到对象存储。只有吞吐和拓扑证明有必要时才引入消息队列。

## 5. 演示讲解顺序

1. 运行 `npm run demo:check`，说明 JDK、Docker、Claude CLI 和令牌检查。
2. 打开架构图，用 30 秒解释两条路径。
3. `npm run demo:start` 后展示 Node/Spring health。
4. `npm run demo:verify`，观察四步任务和真实审批。
5. 打开 Task Center，展示时间线、Approval 和 Artifact。
6. 打开 Markdown evidence，展示 4/4 Task 和最终测试 3/3。
7. `npm run demo:stop`，说明只停止脚本拥有的进程且不输出临时令牌。

不要把 10 分钟都花在等待模型。正式面试前先完成一轮并保留证据；现场演示重点是审批和报告，后台可并行跑新一轮。

## 6. 容易说错的地方

- 不说“从零开发 Claude Code 平台”，说“基于 CloudCLI 二次开发 Control Plane”。
- 不说“支持正式 Claude/Codex 多 Executor”，说“正式 Task 已真实验证 Claude，协议为后续适配留边界”。
- 不说“Exactly-Once”，说“At-Least-Once + 消费端幂等”。
- 不说“所有故障都能恢复”，说“事件投递可恢复；Provider Run 崩溃恢复仍需 Lease/Heartbeat”。
- 不说“审批超时已完成”，当前只证明真实审批往返和取消/迟到决策保护。
- 不把 222 条上游 Lint warnings 说成全仓零告警；准确表述是 0 errors。
