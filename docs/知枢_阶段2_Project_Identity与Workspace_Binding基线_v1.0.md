# 知枢阶段 2：Project Identity 与 Workspace Binding 基线 v1.0

> 文档性质：阶段 2.1 身份审计、稳定语义契约与迁移基线；阶段 2.2 记录实际只读解析与认证边界。  
> 基线日期：2026-08-15。  
> 状态：V1 领域契约、V6/V7 数据库骨架、稳定 machineId、确定性只读解析、Service Credential 与确认式移动/重绑定已落地。  
> 适用范围：新 Task Center；不改变旧 `AgentTaskCenter` 前端。

---

## 1. 结论

稳定 Project Identity 必须由 Spring Control Plane / PostgreSQL 所有。Node SQLite 的 `projects.project_id` 是单机客户端本地标识，Workspace Path 是一次挂载位置，二者都不能单独充当长期项目身份。

```text
Control Project UUID              长期权威身份
  └─ Workspace Binding            某台机器上的一次挂载
       ├─ machineId
       ├─ localProjectId          Node SQLite 本地 locator
       ├─ normalizedWorkspacePath
       └─ repository metadata

runtime_project_ref               control-v1 兼容执行路径，暂时保留
```

阶段 2.1 不把路径迁移成新的 Project，不自动合并候选，也不改变 Runtime `projectRef` 语义。移动、重绑定或冲突必须先形成确定性解析结果；存在歧义时进入 Proposal / 用户确认，而不是静默创建或合并。

## 2. 当前真实身份审计

### 2.1 Node SQLite Project

当前 `projects` 表：

- `project_id TEXT PRIMARY KEY`：由 Node 创建，通常为 UUID，但历史迁移允许保留非空旧 `workspace_id`，因此协议不能假设它永远符合 UUID 格式；
- `project_path TEXT UNIQUE`：经 `normalizeProjectPath` 后保存；
- `custom_project_name`、`isStarred`、`isArchived`：本机 UI 元数据；
- `sessions.project_path` 仍通过路径关联本机会话。

该 ID 对浏览器 Tab、Sidebar 和本机 API 是稳定 locator，但它没有 machine scope，也不是 PostgreSQL Project 的权威主键。

### 2.2 Control Plane Project

当前 `project` 表：

- `id UUID PRIMARY KEY`：已具备成为长期 Project Identity 的条件；
- `runtime_project_ref TEXT UNIQUE`：当前实际是工作区路径；
- `display_root_path`：当前同样是路径；
- `repository_url`：可空，当前没有形成稳定 repository identity；
- Task、Profile、Approval Policy 均引用 `project.id`。

`POST /projects/ensure` 使用 Node 候选 UUID 创建项目；如果同一路径已经存在，则 PostgreSQL 返回既有 Control Project UUID。因此 Node `project_id` 与 Control `project.id` 可能相同，也可能不同，不能直接互换。

### 2.3 Workspace Path / Runtime Project Ref

阶段 1 Gateway 使用：

```text
local projectId
  → Node projects.project_path
  → GET /projects/resolve?projectRef=<path>
  → Control projectId
```

它可以满足同机同路径只读访问，但无法正确表达：

- 工作区移动或重命名；
- 同一 Project 的多个 clone / worktree；
- 多台机器上的挂载；
- 路径复用给另一个仓库；
- 同一 remote 的多个逻辑 Project；
- localProjectId 和路径分别指向不同 Control Project 的冲突。

## 3. 路径规范化基线

当前 Node `normalizeProjectPath` 规则：

1. trim；
2. 去除 Windows `\\?\` / `\\?\UNC\` 长路径前缀；
3. 按 Windows 或 POSIX 规则规范分隔符和 `.` / `..`；
4. 除根目录外移除尾部分隔符；
5. 保留大小写。

`validateWorkspacePath` 对存在的路径进一步使用 `realpath` 解析符号链接，并执行系统目录和 `WORKSPACES_ROOT` 安全检查。Control Plane 当前只对 `projectRef` trim，不具备跨平台文件系统语义。

V1 决策：

- `normalizedWorkspacePath` 必须由受信 Node 在完成安全校验后提供；
- PostgreSQL 保存并按 `machineId + normalizedWorkspacePath` 比较，不自行猜测 Windows/POSIX 规则；
- 不统一 lower-case，因为 Linux 区分大小写，Windows 大小写与卷配置也可能不同；
- 同一物理路径的 symlink/realpath 消歧由 Node 完成；
- 浏览器不得自行生成权威 normalized path。

## 4. 稳定领域模型

### 4.1 Project Identity V1

- `projectId`：沿用现有 PostgreSQL `project.id`；
- `displayName`：项目展示名；
- `repositoryIdentity`：可空的规范化仓库身份，不能仅凭它自动合并；
- `status`：`ACTIVE | ARCHIVED`；
- `identityVersion >= 1`：身份元数据和绑定决策的乐观并发基线。

路径变化不得改变 `projectId`。关闭、归档或移动 Workspace 也不得级联删除 Task / Attempt / Artifact。

### 4.2 Workspace Binding V1

- `workspaceId`：绑定自身 UUID；
- `projectId`：权威 Project UUID；
- `machineId`：Node 安装/机器稳定标识；
- `localProjectId`：可空的 Node SQLite locator，按 machine scope 唯一；
- `workspacePath`：当前用户可见路径；
- `normalizedWorkspacePath`：Node 规范化后的比较键；
- `repositoryUrl / remoteFingerprint / branch`：识别证据，不是单独的自动合并授权；
- `isPrimary`；
- `status`：`ACTIVE | MOVED | DETACHED | STALE`；
- `lastSeenAt` 与审计时间。

约束：

- 同一 `machineId + normalizedWorkspacePath` 只能属于一个 binding；
- 同一 `machineId + localProjectId` 最多指向一个 binding；
- 同一 Project 同时最多一个 `ACTIVE + isPrimary` binding；
- 一个 Project 可以拥有多个历史或非主 binding；
- 路径移动通过旧 binding 状态变化和新/更新 binding 表达，不创建新 Project。

## 5. Repository Identity 与匹配强度

未来 `remoteFingerprint` 建议基于去凭证后的 canonical remote 计算，至少规范 scheme/host、SSH/HTTPS 等价形式、尾部 `.git` 和分隔符。具体算法必须版本化，阶段 2.1 不在数据库中猜测。

匹配强度：

1. `machineId + localProjectId`：精确本机映射；
2. `machineId + normalizedWorkspacePath`：精确挂载映射；
3. `remoteFingerprint`：强候选，但同一仓库可能对应多个逻辑 Project；
4. 旧 `runtime_project_ref`：兼容候选，仅用于迁移期；
5. 文件夹名或 displayName：不得作为身份匹配依据。

当不同精确信号指向不同 Project 时，结果必须为 `AMBIGUOUS`，不得按优先级静默覆盖。

## 6. 移动、重绑定与歧义规则

### 6.1 同一 localProjectId，路径改变

- 如果 repository 证据一致：生成 `MOVE_WORKSPACE` Proposal；
- 用户或后续确定性安全规则批准后，旧路径不再 ACTIVE，新路径继续绑定原 Project；
- `projectId` 不变。

### 6.2 路径相同，localProjectId 改变

- 可能是 Node SQLite 重建或路径被复用；
- repository 证据一致时生成 `REBIND_LOCAL_PROJECT` Proposal；
- repository 证据冲突时必须 `AMBIGUOUS`，禁止覆盖。

### 6.3 remote 相同，多 Project 候选

- 返回候选列表和匹配证据；
- 生成 `MERGE_REVIEW` 或 `CREATE_BINDING` Proposal；
- 不自动合并 Project，不移动 Task 所有权。

### 6.4 无匹配

- 结果为 `NOT_FOUND` 或 `PROPOSAL_REQUIRED`；
- 创建 Project 必须是显式写操作，记录 actor 和幂等请求 ID；
- 阶段 1 的只读 Gateway 继续返回未登记，不隐式 ensure。

## 7. V6 增量迁移

迁移文件：`control-plane/src/main/resources/db/migration/V6__project_identity_workspace_binding.sql`。

迁移只新增：

- `project.status`；
- `project.repository_identity`；
- `project.identity_version`；
- `workspace_binding` 表及唯一性/查询索引；
- 从现有 `project.runtime_project_ref` 生成 `legacy-unscoped` 主 binding。

兼容策略：

- 不修改 V1～V5；
- 不删除或重命名 `runtime_project_ref`、`display_root_path`；
- 不改变 `control-v1`、Runtime Start、Approval Policy 的路径读取；
- 旧项目的 backfill binding 使用 `workspaceId = projectId`，便于确定性迁移；
- 旧 binding 的 `localProjectId` 保持空，禁止假设 Control UUID 就是 Node local ID；
- 后续服务完成新旧双读后，才考虑停止以 `runtime_project_ref` 作为解析主键。

## 8. 机器可读契约

`contracts/project-control-v1/project-identity.schema.json` 固化：

- `ProjectIdentityV1`；
- `WorkspaceBindingV1`；
- 匹配 Candidate；
- `ProjectIdentityResolutionV1`；
- `WorkspaceBindingProposalV1`；
- `MATCHED / PROPOSAL_REQUIRED / AMBIGUOUS / NOT_FOUND` 结果；
- 移动、重绑定、创建和合并复核动作。

本 Schema 是阶段 2 后续 API / DTO 的语义依据，不代表这些 API 已经存在。

## 9. 认证与所有权边界

- Project Identity / Workspace Binding 的权威写入位于 Spring Control Plane；
- Node 负责本机 machine/local/path/repository observation，并通过 Service Credential 提交；
- 浏览器 User JWT 不能直接伪造 machine observation；
- Runtime Token 不能创建、移动或合并 Project；
- 用户确认歧义、移动或合并时必须记录 actor；
- Node SQLite 不直接查询 PostgreSQL，Spring 不直接读取 Node SQLite。

阶段 2.2 已建立独立于 Runtime Token 的 `ZS_PROJECT_CONTROL_TOKEN`，并把新任务中心的 Workspace、Task、Attempt、Approval、Artifact、Follow-up 与 Approval Policy 读取迁入受保护的内部只读协议。actor 审计仍是后续确认式写操作进入 G2 前的硬阻塞。

## 10. Gate 与下一实现批次

阶段 2.1 完成条件：

- 三类身份与权威所有者明确；
- 路径规范化规则有真实代码依据；
- 移动、重绑定、歧义和无匹配行为明确；
- JSON Schema 可机器解析；
- V6 只新增迁移可由 PostgreSQL/Testcontainers 应用；
- 旧执行协议和阶段 1 只读 Gateway 行为不变。

阶段 2.2 实际完成：

1. 建立稳定 `machineId` 的 Node 本机存储；
2. 实现 Control Plane Workspace Binding Repository / Service / 版本化 DTO；
3. 建立 Service Credential 保护的内部 observe/resolve 接口；
4. 实现 localProjectId、路径、remote 候选的确定性解析与 `AMBIGUOUS`；
5. 保持旧 `/projects/resolve?projectRef=` 兼容读，不把只读 Dashboard 变成隐式写；
6. 新增 `contracts/project-control-v1/openapi.yaml`，8 个操作均为 GET，并复用现有执行投影；
7. 暂不实现用户确认 UI、Archive/Evidence Protection、Project State、Brain 或 Plan。

阶段 2.3 已完成：Resolution 生成确定性 MOVE/REBIND Proposal；Node 从认证用户派生 actor；Spring 在确认时重算 Proposal，使用 client request 幂等、identityVersion 并发检查和 V7 before/after 审计后更新 binding。只读 Dashboard 不会隐式触发，Project/Task 所有权不变。

阶段 2.4 唯一入口：Task Archive、Evidence Reference 与引用保护；不得提前进入 Project State、Brain、Plan 或多 Agent。
