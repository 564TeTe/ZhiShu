# 知枢｜AI 研发协作与 Coding Agent 编排平台

知枢不是重新实现 Claude Code，也不是给模型套一层聊天界面。它基于开源 CloudCLI UI 二次开发：保留成熟的 React、Node.js、Provider、文件、Shell、Git 和 WebSocket 能力，新增 Spring Boot Control Plane，把一次不可治理的 Agent 调用升级为可追踪、可审批、可取消、可重试、可归档的研发任务。

## 项目一句话

> 用 Spring Boot 管任务、状态、审批和结果，用 Node.js 运行真实 Coding Agent，通过版本化 Runtime Protocol 把控制面与执行面解耦。

## 为什么值得做

直接调用 Coding Agent 很容易，但工程上仍缺少四类治理能力：

- 一次执行是瞬时调用，没有 Task/Attempt、重试历史和明确状态机；
- 模型可以调用写文件或 Shell，缺少业务侧可观察、可决策的人工审批；
- Java 与 Node 跨进程通信面临请求超时、重复命令、事件重放和乱序风险；
- 最终输出散落在模型消息和工具日志中，难以作为可验证的研发产物留存。

知枢围绕这些问题实现了正式 AgentTask 链路，同时保留普通 Chat 的低延迟路径。

## 核心能力

| 能力 | 实现方式 | 当前证据 |
|---|---|---|
| Task / Attempt 双层模型 | Retry 创建新 Attempt，旧事件与 Artifact 不覆盖 | 状态机单测、PostgreSQL 集成测试、浏览器 E2E |
| 异步状态机 | `PENDING → STARTING → RUNNING/WAITING_APPROVAL → 终态` | RuntimeEvent 投影驱动状态变化 |
| Runtime Protocol v1 | Spring 发 Start/Cancel/Decision，Node 回传结构化事件 | OpenAPI、JSON Schema、Bearer Token |
| Prompt Assembly | 组装目标、工作目录、Capability、权限策略、上下文和输出契约 | 真实 Claude 四步 Demo |
| 人工 Approval | Provider Permission Hook 暂停 Tool，Spring 决策后恢复/拒绝 | 两轮真实 Edit/Bash 审批往返 |
| 命令幂等 | SQLite 持久化 `idempotencyKey + semantic hash + response` | Start/Cancel/Decision 回归测试 |
| 事件可靠性 | SQLite Outbox、至少一次投递、指数退避、同 Run 顺序屏障、重启恢复 | Outbox/Reporter 集成测试与健康指标 |
| Durable Event + SSE | PostgreSQL 双唯一约束；SSE 支持 Last-Event-ID 重放 | 浏览器时间线和 Demo 事件证据 |
| Artifact | `SUMMARY / FILE_CHANGE / GIT_DIFF / TEST_REPORT / ERROR_REPORT` | Task Center 查询、筛选与真实 Demo |
| 可重复演示 | 环境检查、启动、验收、停止四个脚本 | 连续两轮 8/8 Task 成功 |

## 技术栈

- Control Plane：Java 21、Spring Boot 3、Spring MVC、MyBatis-Plus、PostgreSQL 16、Flyway、SSE。
- Execution Plane：Node.js 22、TypeScript、Express、SQLite、Claude Agent SDK。
- Frontend：React、TypeScript、Vite、Tailwind CSS。
- 工程验证：Docker Compose、Testcontainers、Node Test Runner、Playwright、OpenAPI、JSON Schema。

## 已验证结果

- 固定 Demo 连续执行两轮，共 8/8 个真实 AgentTask 达到 `SUCCEEDED`。
- 两轮均完成 Edit/Bash 的 `APPROVAL_REQUIRED → APPROVAL_RESOLVED`，Provider Tool 在审批后恢复。
- 写入任务均产生 `FILE_CHANGE`，测试任务均产生 `TEST_REPORT`，8 个任务均产生 `SUMMARY`。
- 两轮修复后独立测试均为 3/3 通过。
- Control Plane Maven/Testcontainers 完整回归 20/20 通过。
- Runtime/Outbox 定向回归 18/18 通过；Demo 脚本测试 5/5；环境预检 11/11。
- TypeScript 类型检查、生产构建通过；ESLint 0 errors（保留 222 条上游既有 warnings）。

## 快速演示

日常查看项目，Windows 可直接双击根目录的 `start.bat`，完成环境检查、生产构建、服务启动和浏览器打开；双击 `stop.bat` 安全停止本启动器拥有的进程。macOS / Linux 使用 `bash start.sh` 与 `bash stop.sh`。

完整四步真实 Agent 验收使用：

```powershell
npm run demo:check
npm run demo:start
npm run demo:verify
npm run demo:stop
```

验收脚本会复制隔离 Demo Repository，依次执行只读分析、审批写入、审批测试和交付总结，最后保存完整 JSON/Markdown 证据。具体依赖、端口覆盖和安全边界见 [Demo 运行手册](demo-runbook.md)。

## 项目截图

### 创建任务与 SSE 时间线

![创建任务与 SSE 时间线](../output/playwright/task-center-create-sse-success.png)

### Approval 审批闭环

![Approval 审批闭环](../output/playwright/task-center-approval-approved.png)

### Artifact 归档与展示

![Artifact 展示](../output/playwright/task-center-artifact-summary.png)

## 推荐阅读顺序

1. [系统架构](architecture.md)：模块、数据边界、状态机和关键时序。
2. [Runtime Protocol](runtime-protocol.md)：跨进程契约与可靠投递语义。
3. [Demo 运行手册](demo-runbook.md)：如何复现两轮真实任务。
4. [脱敏验收证据](demo-evidence.md)：两轮任务、审批、Artifact 与测试摘要。
5. [面试讲解](interview-guide.md)：3 分钟、10 分钟讲法与高频追问。
6. [简历项目描述](resume-project.md)：可直接使用的精简版和技术版。
7. [后续完善路线](improvement-roadmap.md)：按秋招收益排序的 P0/P1/P2。
8. [实施进度](implementation-progress.md)：逐阶段实现与测试证据。

## 当前边界

- 正式 AgentTask 当前只验证 Claude Executor；普通 Chat 仍保留 CloudCLI 的其他 Provider 能力。
- 尚未实现 Heartbeat/Lease、Runtime Lost 自动判定和跨机器 Worker 调度。
- Approval Timeout 尚未形成独立治理闭环；当前真实演示在 Provider 等待窗口内完成决策。
- Artifact 以 PostgreSQL 内联文本与元数据为主，文件对象存储和下载接口仍是后续项。
- 项目定位是单机黄金版，不为了“技术栈数量”提前引入 Redis、MQ、微服务或 Kubernetes。

## 二次开发说明

CloudCLI 提供原有 UI、聊天、Provider、文件、Shell、Git 等基础能力；知枢新增或重点改造的是 Spring Control Plane、Runtime Protocol、Task Center、任务/审批/事件/Artifact 模型、Runtime 命令幂等、Persistent Outbox、健康预检以及固定 Demo 验收链路。该边界在简历和面试中应主动说明。
