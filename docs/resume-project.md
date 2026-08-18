# 知枢简历项目描述

下面内容只使用已经实现并验证的能力。投递时按版面选择一种版本，不要把所有版本同时堆进简历。

## 1. 推荐项目名

**知枢｜AI 研发协作与 Coding Agent 编排平台**  
个人项目 / 基于开源 CloudCLI 二次开发

技术栈：Java 21、Spring Boot 3、Spring MVC、MyBatis-Plus、PostgreSQL、Flyway、SSE、React、TypeScript、Node.js、SQLite、Claude Agent SDK、Docker Compose、Testcontainers

## 2. 一页简历精简版

- 基于开源 CloudCLI 设计并实现 Coding Agent **Control Plane / Execution Plane 分离架构**：Spring Boot 管理正式 AgentTask，Node.js 运行真实 Claude Executor；普通 Chat 保留原低延迟链路。
- 设计 **AgentTask / TaskAttempt 双层模型与有限状态机**，实现 Profile Snapshot、Retry 历史隔离、Cancel 和工具 Approval；通过 Provider Permission Hook + pending Promise 实现 Edit/Bash 执行前暂停与决策后恢复。
- 为跨进程 Start/Cancel/Approval 命令实现 SQLite 持久化幂等；构建 RuntimeEvent Persistent Outbox，采用 At-Least-Once、带抖动指数退避和同 Run FIFO，并由 PostgreSQL 双唯一约束完成消费端去重。
- 建立 Event/SSE/Artifact 闭环，支持 Last-Event-ID 断线补历史，并归档 Summary、文件变更、Git Diff、测试和错误报告；连续两轮真实 Claude Demo 共 **8/8 Task 成功**，两轮最终测试均 **3/3 通过**。

## 3. Java 后端岗位版本

- 使用 Java 21、Spring Boot、MyBatis-Plus、PostgreSQL 与 Flyway 构建 Coding Agent 控制面，设计 Project/Profile/Task/Attempt/Event/Approval/Artifact 领域模型和显式状态机。
- 将数据库事务与 Node HTTP 边界分离：先提交 PENDING Attempt，再发幂等 Runtime 命令；以 RuntimeEvent 驱动状态投影，并处理回调早于 acceptance 的 Deferred Reconcile 竞态。
- 通过 `event_id` 与 `(attempt_id, sequence_no)` 双唯一约束吸收 At-Least-Once 重复事件；使用 SSE + Last-Event-ID 提供提交后实时推送和断线重放。
- 基于 Provider Permission Hook 实现审批持久化与决策回调，保护取消后迟到审批；使用 Testcontainers 覆盖 Flyway、UUID 映射、事件/Artifact 幂等和状态投影，Java 完整回归 **20/20** 通过。

## 4. Agent / AI 工程岗位版本

- 在成熟 Claude Agent Runtime 上增加结构化 Task 模式，将目标、工作区、Capability、Permission Policy、历史上下文和输出契约组装为受治理 Prompt，避免退化为普通聊天转发。
- 将 READ/WRITE/SEARCH/SHELL/GIT/TEST Capability 映射到 Provider Tool 策略，通过 Permission Hook 在 Tool 执行前暂停，真实完成 Edit/Bash 的跨进程人工审批与恢复。
- 把 Provider 状态、Tool 调用和结果规范化为 10 类 RuntimeEvent 与 5 类 Artifact，使 Agent 执行具备可查询时间线、测试证据和 Attempt 归属。
- 构建固定缺陷仓库与四步自动验收（只读分析 → 审批写入 → 审批测试 → 总结），连续两轮真实执行 **8/8 Task 成功**，验证模型输出之外的代码与测试结果。

## 5. 系统设计亮点版

- **分层与边界**：Spring 拥有 PostgreSQL 业务事实，Node 拥有 SQLite 执行状态；两侧不共享数据库，仅通过 Runtime Protocol 和关联 ID 协作。
- **幂等与一致性**：命令使用 `idempotencyKey + semantic hash` 持久化去重；事件采用 At-Least-Once + 双唯一约束，避免把网络语义误写成 Exactly-Once。
- **顺序与恢复**：Outbox 同 Run 使用 sequence 屏障，失败后带抖动指数退避，Node 重启继续补报；健康接口暴露 pending、due、oldest 和 maxAttempts。
- **竞态处理**：区分 Accepted/Started；处理回调早到、Cancel/Approval 竞争、SSE 断线和重复事件。
- **范围控制**：单机阶段不提前引入 MQ/Redis/K8s；明确将 Heartbeat/Lease、多 Worker 和对象存储作为按需求演进项。

## 6. 可量化指标

可按面试场景选用，数字不要自行放大：

- 固定真实 E2E：连续 2 轮，共 8/8 个 AgentTask 成功。
- 最终仓库测试：两轮均 3/3 通过。
- 真实 Approval：两轮均完成 Edit 与 Bash 的暂停/批准/恢复链路。
- Control Plane：Maven/Testcontainers 20/20 通过。
- Runtime/Outbox：定向回归 18/18 通过。
- Demo 自动化：脚本测试 5/5，环境检查 11/11。
- 工程质量：TypeScript typecheck 和生产 build 通过；ESLint 0 errors。

## 7. 30 秒项目介绍

> 知枢是我基于 CloudCLI 二次开发的 Coding Agent 编排平台。我保留 Node 作为 Execution Plane，用 Spring Boot 和 PostgreSQL 建立 Control Plane，重点解决 Task/Attempt 状态、真实工具审批、跨进程命令幂等、事件可靠投递和 Artifact 归档。项目通过固定仓库连续跑了两轮真实 Claude，共 8 个任务全部成功，并保留了审批、事件和测试证据。

## 8. 职责边界写法

推荐：

> 基于开源 CloudCLI 的 React/Node Agent 基础能力，负责知枢控制面与正式任务链路的架构设计和实现，包括 Spring Boot Control Plane、Runtime Protocol、Task Center、状态/审批/事件/Artifact、Node 幂等与 Outbox、测试及固定 Demo。

避免：

- “从零实现支持 Claude/Codex 的完整 IDE”；
- “实现分布式 Exactly-Once 消息系统”；
- “实现 Agent 崩溃自动恢复和多 Worker 调度”；
- “实现全链路零故障、零警告”。

## 9. STAR 复盘素材

### 场景

原系统能调用 Coding Agent，但执行过程缺少业务任务、审批和可恢复事件，无法稳定作为研发任务平台展示。

### 任务

在不重写成熟 Agent Runtime 的前提下，完成个人可交付的黄金版：真实执行、审批、取消/重试、事件、Artifact 和可重复 Demo。

### 行动

拆分控制面/执行面；设计 Task/Attempt 状态机与协议；实现命令幂等和 Outbox；接入 Permission Hook；用 Testcontainers、浏览器 E2E 和固定四步 Demo 分层验证。

### 结果

连续两轮真实 Claude Demo 8/8 Task 成功，写入与测试均经过审批，最终测试均 3/3；形成一键检查、启动、验收、停止与证据报告。

## 10. 投递前检查

- 简历链接打开后应先看到根 README 的知枢入口，而不是只有上游说明。
- 保留一份脱敏 Demo 报告或截图；`.zhishu-demo` 内含临时令牌，不应提交。
- 能解释 202/STARTING、Task/Attempt、At-Least-Once、Approval Promise 和当前未实现项。
- 若修改了指标，必须同步 [实施进度](implementation-progress.md) 和真实测试证据。
