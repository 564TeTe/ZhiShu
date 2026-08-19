# 知枢

知枢是一个面向 AI 研发协作的任务中心与项目大脑。它把 Coding Agent 的执行过程接入可追踪、可审批、可重试、可回放的工程流程，帮助你从“发一条提示词”升级到“管理一次完整研发任务”。

知枢由 React 前端、Node.js 执行面和 Java 21 + Spring Boot + PostgreSQL 控制面组成。普通对话仍保持轻量路径；正式研发任务则通过 Task、Attempt、审批、Runtime Event 和 Artifact 形成完整闭环。

## 你可以用知枢做什么

- 创建和跟踪研发任务，查看任务、执行尝试和状态变化
- 对文件修改、Shell 命令等高风险操作进行人工审批、拒绝、取消和重试
- 通过事件时间线和 SSE 回放还原执行过程，不依赖临时日志
- 汇总文件变更、测试结果、错误报告和执行摘要等研发产物
- 管理项目状态、计划、工作单、执行报告和 Agent 能力矩阵
- 在同一个界面使用 Claude Code、Cursor CLI、Codex 等 Coding Agent
- 使用文件浏览、Git、Shell、MCP、浏览器和插件能力完成日常开发
- 在桌面、平板和移动浏览器上访问项目与会话

## 项目状态

- 新任务中心与项目大脑建设计划的阶段 0 至 10 已完成
- Control Plane 回归测试通过，PostgreSQL V1 至 V27 空库迁移通过
- Golden 36/36、Control Plane 21 suites / 93 tests 通过
- Node 全仓测试：347 pass、0 fail、1 skip
- `npm run typecheck`、`npm run build` 通过

详细证据和边界请查看[实施进度](docs/implementation-progress.md)与[项目总览](docs/zhishu-project.md)。

## 快速开始

### Windows

双击根目录的 `start.bat`。停止服务时使用 `stop.bat`，它只会停止本启动器创建的进程。

### macOS / Linux

```bash
bash start.sh
```

停止服务：

```bash
bash stop.sh
```

### 开发命令

```bash
npm install
npm run typecheck
npm run build
npm test
```

知枢演示链路：

```bash
npm run demo:check
npm run demo:start
npm run demo:verify
npm run demo:stop
```

默认前端地址为 `http://localhost:3001`。首次运行前请复制 `.env.example` 为 `.env`，并按本机环境填写配置。不要把 `.env`、数据库、日志或构建产物提交到仓库。

## 系统结构

```text
浏览器 / 桌面端
        |
        v
React + Vite 前端
        |
        +--> Node.js 执行面：Provider、会话、Shell、文件、Git、MCP
        |
        +--> Spring Boot 控制面：Task、Attempt、审批、计划、Artifact、事件投影
                              |
                              v
                         PostgreSQL
```

- [系统架构](docs/architecture.md)：模块边界、数据流和关键时序
- [Runtime Protocol](docs/runtime-protocol.md)：控制面与执行面的跨进程契约
- [任务中心与项目大脑总计划](docs/知枢_新任务中心与项目大脑_建设总计划_v1.0.md)：建设目标、阶段记录和最新风险
- [一键演示手册](docs/demo-runbook.md)：如何在隔离环境复现真实任务链路
- [仓库结构说明](docs/repository-layout.md)：代码、契约、服务和文档的归属

## 安全边界

知枢不会替你绕过 Agent 或项目的权限策略。涉及写文件、执行命令和集成构建的操作应经过明确的策略和审批；真实生产项目、密钥和个人配置不应放入演示仓库。当前支持的 Agent、平台和隔离能力以代码与文档中的验证结果为准。

## 技术来源与许可证

知枢在开源 CloudCLI UI 的 React/Node 基础能力上进行二次开发，同时新增了自己的控制面、任务模型、事件协议和项目治理模块。上游名称仅用于说明技术来源，不代表知枢提供上游托管服务或官方支持。

知枢以 AGPL-3.0-or-later 发布，详见 [LICENSE](LICENSE)。

## 参与与反馈

- [知枢 GitHub 仓库](https://github.com/564TeTe/ZhiShu)
- [问题反馈](https://github.com/564TeTe/ZhiShu/issues)
- [文档导航](docs/README.md)
- [贡献指南](CONTRIBUTING.md)

知枢使用 Claude Code、Cursor CLI、Codex、React、Vite、Tailwind CSS、Spring Boot、PostgreSQL 等开源工具和技术构建。感谢所有上游项目与社区贡献者。
