# 知枢系统架构

## 1. 总体架构

```mermaid
flowchart LR
    User["研发用户"]
    subgraph Frontend["React 前端"]
        Chat["普通 Chat"]
        TaskCenter["Agent Task Center"]
    end
    subgraph Control["Spring Boot Control Plane"]
        Task["Task / Attempt / 状态机"]
        Approval["Approval / Cancel / Retry"]
        Event["Event 投影 / SSE Replay"]
        Artifact["Artifact 查询"]
    end
    subgraph Execution["Node.js Execution Plane"]
        RuntimeAPI["Runtime Protocol API"]
        Prompt["Prompt Assembly / Capability Policy"]
        Provider["Claude Provider Runtime"]
        Outbox["SQLite Command Dedup + Event Outbox"]
    end
    PG[("PostgreSQL")]
    SQLite[("Node SQLite")]
    Repo[("本地代码仓库")]

    User --> Chat
    User --> TaskCenter
    Chat <-->|"WebSocket / HTTP"| Provider
    TaskCenter -->|"REST"| Task
    Event -->|"SSE + Last-Event-ID"| TaskCenter
    Task -->|"Start / Cancel / Decision"| RuntimeAPI
    Outbox -->|"RuntimeEvent Batch"| Event
    RuntimeAPI --> Prompt --> Provider
    Provider --> Repo
    Task --> PG
    Approval --> PG
    Event --> PG
    Artifact --> PG
    RuntimeAPI --> SQLite
    Outbox --> SQLite
```

这里有两条刻意分开的产品路径：

- 普通 Chat：`React ↔ Node ↔ Provider`，追求低延迟，不创建业务 Task，也不依赖 Spring。
- 正式 AgentTask：`React ↔ Spring ↔ Node ↔ Provider`，接受额外编排成本，换取状态、审批、可靠性和归档。

## 2. 模块职责

| 层 | 模块 | 职责 |
|---|---|---|
| React | `agent-tasks` | Project 登记、Task 创建/列表、SSE 时间线、审批、取消、重试、Artifact 筛选 |
| Spring | `project/profile` | 本地工作区业务映射与不可变 Profile Snapshot |
| Spring | `task` | Task/Attempt 创建、状态机、Retry/Cancel 编排 |
| Spring | `runtime` | Runtime Protocol HTTP Client、共享令牌认证 |
| Spring | `event` | RuntimeEvent 幂等入库、投影、Deferred Reconcile、SSE 重放 |
| Spring | `approval` | 待审批查询、决策、竞态冲突处理 |
| Spring | `artifact` | 五类 Artifact 持久化与查询 |
| Node | `runtime` | Start/Cancel/Decision、Prompt Assembly、Provider 调度、事件生成 |
| Node | `database` | Runtime Command Dedup 与 Persistent Event Outbox |
| Node | `providers` | 真实 Claude 执行、Permission Hook、Tool 消息与中止 |

## 3. 数据所有权

```mermaid
flowchart TB
    subgraph PostgreSQL["Spring 所有：PostgreSQL"]
        Project["Project / AgentProfile"]
        Task["AgentTask / TaskAttempt"]
        Event["TaskEvent / ApprovalRequest / TaskArtifact"]
    end
    subgraph SQLite["Node 所有：SQLite"]
        Dedup["runtime_command_dedup"]
        Outbox["runtime_event_outbox"]
        Existing["既有本地数据"]
    end
    Correlation["taskId + attemptId + runtimeRunId + projectRef"]
    PostgreSQL --- Correlation --- SQLite
```

Java 不查询 Node SQLite，Node 也不查询 PostgreSQL。两侧只通过协议标识关联，避免形成隐式共享数据库耦合。

## 4. Task / Attempt 状态机

```mermaid
stateDiagram-v2
    [*] --> PENDING
    PENDING --> STARTING: Node 202 Accepted
    PENDING --> FAILED: Start 失败
    STARTING --> RUNNING: RUN_STARTED
    STARTING --> CANCELLING: Cancel
    STARTING --> FAILED: Runtime 错误
    RUNNING --> WAITING_APPROVAL: APPROVAL_REQUIRED
    WAITING_APPROVAL --> RUNNING: APPROVAL_RESOLVED
    RUNNING --> CANCELLING: Cancel
    WAITING_APPROVAL --> CANCELLING: Cancel
    RUNNING --> SUCCEEDED: RUN_COMPLETED
    RUNNING --> FAILED: RUN_FAILED
    CANCELLING --> ABORTED: RUN_ABORTED
    CANCELLING --> FAILED: Cancel 失败
    SUCCEEDED --> [*]
    FAILED --> [*]
    ABORTED --> [*]
```

`202 Accepted` 只表示 Node 接受命令，所以 Attempt 进入 `STARTING`；只有收到 `RUN_STARTED` 才进入 `RUNNING`。Retry 不复活旧 Attempt，而是创建 Attempt N+1，保留旧 Event 与 Artifact。

## 5. 创建任务与事件回传时序

```mermaid
sequenceDiagram
    actor U as 用户
    participant R as React Task Center
    participant S as Spring Control Plane
    participant P as PostgreSQL
    participant N as Node Runtime
    participant Q as SQLite Outbox
    participant C as Claude Executor

    U->>R: 创建正式 AgentTask
    R->>S: POST /api/v1/tasks
    S->>P: 保存 Task + PENDING Attempt + Profile Snapshot
    S->>N: POST /internal/runtime/v1/runs (idempotencyKey)
    N->>N: 配置预检 + 持久化命令去重
    N-->>S: 202 Accepted + runtimeRunId
    S->>P: Attempt = STARTING
    N->>C: 启动真实 Agent
    C-->>N: 状态 / Tool / 最终消息
    N->>Q: 先持久化 RuntimeEvent
    Q->>S: 至少一次批量投递
    S->>P: eventId + attempt/sequence 双重幂等并投影状态
    S-->>R: SSE 实时推送；断线按 Last-Event-ID 补齐
```

## 6. Approval 时序

```mermaid
sequenceDiagram
    participant C as Claude Tool
    participant N as Node Permission Hook
    participant O as SQLite Outbox
    participant S as Spring Control Plane
    participant R as React Task Center

    C->>N: 请求 Edit / Bash
    N->>N: 注册 pending Promise
    N->>O: 持久化 APPROVAL_REQUIRED
    O->>S: 回传审批事件
    S->>S: 保存 Approval，Attempt = WAITING_APPROVAL
    S-->>R: SSE 展示审批卡片
    R->>S: APPROVED / DENIED
    S->>N: Approval Decision + idempotencyKey
    N->>N: 校验仍 pending，resolve Permission Hook
    N->>O: APPROVAL_RESOLVED
    N-->>C: 允许或拒绝 Tool
```

Cancel 与 Decision 竞争时，Node 先检查 Run 是否终态、审批是否仍 pending；迟到决策返回 409，不恢复已取消的 Tool。

## 7. 可靠投递与幂等

```mermaid
flowchart LR
    E["生成 RuntimeEvent"] --> S["SQLite Outbox 持久化"]
    S --> H{"HTTP 投递"}
    H -->|"2xx"| D["删除 Outbox 记录"]
    H -->|"失败"| B["记录 attempts / lastError / nextAttemptAt"]
    B --> R["带抖动指数退避"] --> H
    H --> J["PostgreSQL task_event"]
    J --> U1["UNIQUE event_id"]
    J --> U2["UNIQUE attempt_id, sequence_no"]
```

- 语义为 At-Least-Once：网络超时后允许重复投递，Spring 精确去重。
- 同一 Run 使用 sequence 屏障，前序失败时后序不越过；不同 Run 可独立推进。
- Node 重启后重新扫描 pending 记录；健康接口暴露 pending/due/oldest/attempts/error，不返回令牌。
- 尚未实现 Heartbeat/Lease，因此不能声称 Provider 进程崩溃后的 Run 自动恢复。

## 8. 安全与故障边界

- 内部 Runtime/Control API 使用独立 Bearer Token；未配置时正式 Start 在 Provider 启动前返回 503。
- 配置错误响应和 health 只返回配置项名称，不返回秘密值。
- Profile Snapshot 只冻结执行策略，不保存 API Key、Token 或 Authorization。
- 普通 Chat 与正式 Task 解耦：Spring 暂停不会让原 Chat 路径不可用。
- 当前是单机实现；面向多 Worker 演进时需要 Worker Registry、Lease、调度和对象存储，而不是简单复制 Node 实例。
