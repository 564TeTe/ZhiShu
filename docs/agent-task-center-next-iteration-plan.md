# Agent 任务中心后续迭代计划

更新时间：2026-08-14

## 1. 背景与核心判断

当前 Agent 任务中心已经具备以下能力：

- 创建任务并启动 Agent
- 选择 Claude、Codex、OpenCode 执行器
- 展示任务状态、Attempt、事件时间线和任务产物
- 支持人工审批、取消、重试和删除
- 支持命令、工作目录、文件路径和文件变更展示

当前的主要问题是：任务执行结束后，系统只能说明 Agent 运行成功或失败，不能明确说明用户的问题是否真的解决。失败后主要依赖重试，用户无法方便地补充反馈并继续推进。

因此，下一阶段不应继续把任务中心做成“带日志的聊天窗口”，而应该把它建设成“可验收、可跟进、可审计的问题闭环”。

## 2. 任务中心与普通对话的边界

### 普通对话

- 适合临时提问、讨论方案和快速试错
- 上下文以聊天消息为主
- 没有明确的验收责任
- 不要求固定的执行记录和交付物

### Agent 任务中心

- 面向一个明确的问题或研发目标
- 必须保存目标、约束和验收标准
- 每次执行都形成独立 Attempt
- 保留事件、审批、代码变更和测试结果
- 用户可以确认是否解决
- 未解决时继续在同一个任务下推进

任务中心不应该因为一次执行结束就结束。一次执行只是一个 Attempt，问题是否解决需要独立验收。

## 3. 第一优先级：执行状态与解决状态分离

当前 `SUCCEEDED` 表示 Agent 进程执行完成，不等于问题已解决。

建议保留 Attempt 执行状态，同时增加任务级解决状态：

```text
执行状态：PENDING / RUNNING / WAITING_APPROVAL / SUCCEEDED / FAILED / ABORTED
解决状态：OPEN / IN_PROGRESS / WAITING_ACCEPTANCE / NEEDS_FOLLOW_UP / RESOLVED / CLOSED
```

建议流程：

```text
创建任务
  -> Agent 执行
  -> 执行完成
  -> 等待用户验收
  -> 已解决 / 需要跟进 / 关闭
```

执行完成后，界面应显示：

> Agent 已完成执行，请确认问题是否解决。

用户可以选择：

- 已解决
- 仍未解决，添加跟进
- 结果部分正确，继续修改
- 关闭任务

## 4. 第二优先级：同一任务内的跟进

### 4.1 目标

用户发现问题没有解决时，不新建重复任务，也不退回普通聊天，而是在当前任务下创建新的 Attempt。

### 4.2 用户流程

```text
Attempt #1 执行完成
  -> 用户点击“添加跟进”
  -> 填写反馈、补充条件或新的验收要求
  -> 创建 Attempt #2
  -> Agent 读取历史结果和跟进内容
  -> 生成新的修改、测试和产物
```

### 4.3 跟进内容

跟进记录至少包含：

- 用户反馈
- 关联的上一次 Attempt
- 上一次执行总结
- 上一次失败原因
- 已修改文件
- 已运行测试
- 新增验收要求
- 可选的日志、截图和文件附件

示例：

```text
任务：修复登录失败问题

Attempt #1：Agent 判断已修复，但用户验收仍失败
跟进反馈：手机号登录仍然失败，错误发生在验证码校验之后
Attempt #2：继续检查验证码校验流程并补充回归测试
```

### 4.4 数据模型建议

不要把跟进内容直接拼接到普通 prompt 中而不留记录。建议增加任务跟进记录：

```text
task_follow_up
- id
- task_id
- parent_attempt_id
- feedback
- requested_acceptance
- attachments
- status
- created_at
- completed_at
```

新的 Attempt 关联 `task_follow_up`，旧 Attempt 的事件和产物保持不变。

### 4.5 前端形态

任务详情中增加：

- “添加跟进”按钮
- “从失败处继续”快捷操作
- “重新定义目标”快捷操作
- Attempt 历史列表
- 每次跟进的反馈、执行结果和验收状态

任务列表仍然只显示一个任务，不因为跟进产生多个重复任务。

## 5. 第三优先级：自动审批

自动审批不建议做成无条件的“全部允许”。正确方向是基于任务、项目和工具风险的策略审批。

### 5.1 审批模式

建议支持：

```text
MANUAL       所有高风险操作需要人工确认
AUTO_SAFE    低风险读取、测试和构建自动通过
AUTO_TRUSTED 低风险操作和用户配置的受信任命令自动通过
```

任务中心创建任务时可以选择本次任务的审批模式，项目设置可以提供默认模式。

### 5.2 默认自动允许

可以默认自动通过：

- 读取文件
- 搜索代码
- 查看目录
- 查看 Git diff
- 查看日志
- 执行测试
- 执行 lint
- 执行构建

### 5.3 受信任命令

用户可以为项目配置精确允许的命令，例如：

```text
npm test
npm run build
mvn test
mvn package
git diff
```

安全限制：

- 命令只能在当前项目目录执行
- 使用结构化命令匹配，不能只做字符串前缀匹配
- 禁止访问项目外路径
- 默认禁止 `.env`、密钥、凭证和私有配置
- 禁止删除磁盘、注册表和系统级操作
- 禁止任意网络上传

### 5.4 始终人工确认

以下操作默认不能自动放行：

- 删除文件
- 删除数据库数据
- 修改权限
- 读取凭证
- 修改项目外文件
- 任意 shell 命令
- 网络上传
- 大范围覆盖或重命名

### 5.5 审计要求

自动审批也必须写入审批和事件记录：

```text
decision = AUTO_APPROVED
policy = project-default
rule = trusted-command
reason = command matched configured allowlist
```

界面显示“已按规则自动批准”，不能让用户误以为没有发生审批。

## 6. 分阶段实施计划

### 阶段一：问题闭环和跟进

优先级：最高。

工作内容：

1. 增加任务级解决状态。
2. 增加待验收状态和用户确认操作。
3. 增加跟进记录和跟进接口。
4. 同一任务下创建新的 Attempt。
5. Prompt 自动带上历史总结、失败原因和用户反馈。
6. 增加 Attempt 历史视图。
7. 保留原有事件、审批和产物，不覆盖历史。

验收条件：

- 一个任务可以执行多次。
- 每次执行都有独立 Attempt。
- 用户可以明确标记是否解决。
- 未解决时可以继续跟进。
- 任务列表不会出现重复任务。
- Agent 能看到上一次结果和本次反馈。

### 阶段二：审批策略和自动审批

工作内容：

1. 增加审批模式和项目默认策略。
2. 实现低风险操作自动批准。
3. 实现受信任命令和目录规则。
4. Node Runtime 和 Control Plane 同时执行策略校验。
5. 增加自动审批事件和审计字段。
6. 增加审批超时，超时默认拒绝。

验收条件：

- 读取、测试和构建不再打断用户。
- 受信任命令可以自动执行。
- 高风险操作仍然被拦截。
- 自动审批和人工审批都能在时间线中追溯。
- 策略冲突时采用更严格的规则。

### 阶段三：验收和质量门禁

工作内容：

1. 支持用户定义验收标准。
2. Agent 必须运行指定测试。
3. 测试失败时不能自动标记为已解决。
4. 支持重新验证和补充测试。
5. 区分“执行完成”和“验收通过”。
6. 生成最终问题报告。

### 阶段四：可靠性增强

工作内容：

- Approval Timeout 和过期处理
- Runtime 心跳和 Lease
- Provider Run 崩溃恢复
- 断线重连和事件补偿
- Artifact 文件下载
- 失败任务批量重试
- 任务归档和保留策略

## 7. 当前明确不做的事情

- 不把每次跟进都新建成独立任务。
- 不把任务中心改造成普通聊天页面。
- 不默认打开所有命令和文件的自动审批。
- 不用前端隐藏按钮代替后端权限校验。
- 不用“Agent 进程成功退出”冒充“用户问题已解决”。

## 8. 推荐下一步

下一次开发先做阶段一，不先做更多视觉调整：

1. 先增加 `WAITING_ACCEPTANCE / NEEDS_FOLLOW_UP / RESOLVED`。
2. 增加“添加跟进”应用内对话框。
3. 增加跟进记录和 Attempt #2。
4. 增加 Attempt 历史和历史产物查看。
5. 用一个“第一次失败、第二次跟进、第三次验收通过”的真实流程验收。

阶段一稳定后，再实现自动审批策略。否则只是让 Agent 更快地执行，不能解决“执行完但问题没解决”的核心体验问题。

## 9. 当前代码上下文

主要入口：

- 前端任务中心：`src/components/agent-tasks/view/AgentTaskCenter.tsx`
- Control Plane 任务接口：`control-plane/src/main/java/com/zhishu/task/TaskController.java`
- 任务应用服务：`control-plane/src/main/java/com/zhishu/task/TaskApplicationService.java`
- 任务控制：`control-plane/src/main/java/com/zhishu/task/TaskControlService.java`
- 审批服务：`control-plane/src/main/java/com/zhishu/approval/ApprovalService.java`
- 任务状态：`control-plane/src/main/java/com/zhishu/task/AttemptStatus.java`
- 核心数据库结构：`control-plane/src/main/resources/db/migration/V1__golden_core.sql`

当前已有的取消、重试、审批和 Attempt 历史可以直接作为阶段一的基础，不需要重做普通 Chat 链路。
