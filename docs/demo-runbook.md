# 知枢固定 Demo 运行手册

这套演示把“只读分析 → 审批写入 → 审批测试 → Artifact 总结”固定为可重复验收流程。每轮都会复制全新的最小仓库，不会修改 `demo-repository` 模板，也不会把临时令牌写入受版本控制的文件。

## 日常一键启动

Windows 用户直接在项目根目录双击：

```text
start.bat   # 检查、构建、启动，并自动打开浏览器
stop.bat    # 安全停止本启动器拥有的进程
```

如果 Docker daemon 未运行，`start.bat` 会自动启动 Docker Desktop 并等待最多 120 秒。启动过程同时记录到 `.zhishu-demo/logs/launcher-latest.log`；无论成功或失败，窗口都会等待按回车后再关闭，方便查看错误。

macOS / Linux：

```bash
bash start.sh
bash stop.sh
```

也可以在任意平台使用等价命令：

```powershell
npm run zhishu:start
npm run zhishu:stop
```

首次启动会执行生产构建，后续若已存在一套健康的知枢服务则直接复用并打开 `http://127.0.0.1:3001`。启动器会拒绝复用只有一半服务、端口被其他程序占用或健康检查失败的情况，避免 Node 与 Spring 使用不同令牌形成“看似启动、实际不可用”的混合栈。

停止脚本不按端口批量杀进程，只停止 `.zhishu-demo/stack-state.json` 中记录且由启动器创建的 Node/Spring PID；PostgreSQL 也只在本轮由脚本启动时停止，数据卷保留。如果启动器只是复用已有健康服务，停止脚本不会接管或关闭它们。

## 完整 Demo 验收流程

在项目根目录执行：

```powershell
npm run demo:check
npm run demo:start
npm run demo:verify
npm run demo:stop
```

职责划分：

- `demo:check`：检查 Node.js 22、npm、JDK 21、Maven、Docker/Compose、Docker daemon、Claude Code CLI、Node 依赖和 Demo 夹具。
- `demo:start`：构建 Node/Spring，启动 PostgreSQL、Spring Control Plane 和 Node Runtime，并等待三个健康条件成立。
- `demo:verify`：登记隔离工作区，顺序执行四个真实 AgentTask，自动批准固定 Demo 中的写入和测试请求，校验终态、耐久事件、审批次数和 Artifact。
- `demo:stop`：只停止本脚本记录的 Node/Spring PID；PostgreSQL 仅在它由本轮脚本启动时停止，数据卷默认保留。

如已构建且只想重启，可用：

```powershell
node scripts/demo/start-stack.mjs --skip-build
```

## 固定四步任务

1. 只读分析：定位折扣率小于 0、大于 0.5 的两个缺陷，必须产生 `SUMMARY`。
2. 审批写入：只允许修改 `src/pricing.mjs`，必须至少发生一次审批，并产生 `FILE_CHANGE` 与 `SUMMARY`。
3. 审批测试：运行 `npm test`，必须至少发生一次审批，并产生 `TEST_REPORT` 与 `SUMMARY`。
4. Artifact 总结：只读生成交付摘要，必须产生 `SUMMARY`。

验收器还会先证明模板基线存在两个失败测试，四步完成后再独立运行一次 `npm test`，要求三个场景全部通过。

## 证据与故障定位

所有运行期文件都在已忽略的 `.zhishu-demo`：

```text
.zhishu-demo/
├── stack-state.json        # PID、地址、临时共享令牌；不提交
├── node-runtime.db         # 独立 Node SQLite 数据
├── logs/                   # Node/Spring 标准输出与错误
├── workspaces/             # 每轮隔离 Demo 仓库
└── evidence/               # JSON 原始证据与 Markdown 验收报告
```

`demo:start` 失败时先看 `.zhishu-demo/logs`，并运行 `npm run demo:check` 查看缺失依赖。若发生非正常中断，可先运行 `npm run demo:stop`，确认 3001/8080 端口空闲后重新开始。

## 安全与可重复性边界

- 未配置 `ZS_RUNTIME_TOKEN` 时脚本生成 256-bit 临时令牌，只写入忽略目录，并且任何控制台输出都不会显示令牌值。
- 自动审批仅作用于本轮新建的固定 Demo 任务，不轮询或处理其他项目的审批。
- 脚本不会删除 PostgreSQL 数据卷，也不会停止它没有启动的 PostgreSQL。
- 四步任务依赖真实 Claude Code CLI，因此会产生模型调用；脚本自动化验证的是编排链路，并不假设每次模型文字完全一致。
