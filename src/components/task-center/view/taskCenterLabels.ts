const executionStatusLabels: Record<string, string> = {
  PENDING: '待启动',
  STARTING: '启动中',
  RUNNING: '执行中',
  WAITING_APPROVAL: '待审批',
  CANCELLING: '正在取消',
  SUCCEEDED: '执行成功',
  FAILED: '执行失败',
  LOST: '执行失联',
  ABORTED: '已中止',
};

const resolutionStatusLabels: Record<string, string> = {
  OPEN: '待处理',
  IN_PROGRESS: '处理中',
  WAITING_ACCEPTANCE: '待验收',
  NEEDS_FOLLOW_UP: '需跟进',
  RESOLVED: '已解决',
  CLOSED: '已关闭',
};

const runtimeHealthLabels: Record<string, string> = {
  NOT_MONITORED: '未监控',
  HEALTHY: '正常',
  UNKNOWN: '暂时失联',
  LOST: '已失联',
  TERMINATED: '已结束',
};

const approvalModeLabels: Record<string, string> = {
  MANUAL: '人工审批',
  AUTO_APPROVE: '自动批准',
  READ_ONLY: '只读',
};

const planNodeStateLabels: Record<string, string> = {
  NOT_READY: '尚未就绪',
  READY: '可执行',
  BLOCKED: '被阻塞',
  CLAIMED: '已领取',
  DISPATCHING: '下发中',
  DISPATCHED: '已下发',
  RUNNING: '执行中',
  WAITING_APPROVAL: '待审批',
  AWAITING_VERIFICATION: '待验证',
  VERIFIED: '已验证',
  SUCCEEDED: '已成功',
  FAILED: '执行失败',
  REJECTED: '未通过',
  LOST: '执行失联',
  ABORTED: '已中止',
  COMPLETED: '已完成',
};

const proposalStatusLabels: Record<string, string> = {
  PENDING_APPROVAL: '待审批',
  APPROVED: '已批准',
  PARTIALLY_APPROVED: '部分批准',
  REJECTED: '已拒绝',
  STALE: '已过期',
};

const proposalChangeLabels: Record<string, string> = {
  NEW: '新增',
  INHERITED: '沿用',
  MODIFIED: '修改',
  SUPERSEDED: '已替代',
  CANCELLED: '已取消',
};

const capabilityLabels: Record<string, string> = {
  READ_FILE: '读取文件',
  WRITE_FILE: '修改文件',
  SEARCH_CODE: '搜索代码',
  SHELL: '运行命令',
  GIT: '版本管理',
  TEST: '运行测试',
};

const schedulerBlockerLabels: Record<string, string> = {
  SCOPE_MISSING: '缺少工作范围',
  SCOPE_OVERLAP: '工作范围冲突',
  SCOPE_TOO_BROAD: '工作范围过宽',
  CAPABILITY_MISSING: '缺少所需能力',
  PROFILE_MISSING: '没有匹配的执行配置',
  DEPENDENCY_CONFLICT: '任务依赖冲突',
  ACTIVE_SCHEDULE_CONFLICT: '已有活动调度',
  MAX_WORKERS_EXCEEDED: '超出并行数量限制',
};

export function executionStatusLabel(status: string): string {
  return executionStatusLabels[status] ?? status;
}

export function resolutionStatusLabel(status: string): string {
  return resolutionStatusLabels[status] ?? status;
}

export function runtimeHealthLabel(status: string): string {
  return runtimeHealthLabels[status] ?? status;
}

export function approvalModeLabel(mode: string | null): string {
  if (!mode) return '未记录';
  return approvalModeLabels[mode] ?? mode;
}

export function planNodeStateLabel(status: string): string {
  return planNodeStateLabels[status] ?? executionStatusLabel(status);
}

export function proposalStatusLabel(status: string): string {
  return proposalStatusLabels[status] ?? status;
}

export function proposalChangeLabel(changeType: string): string {
  return proposalChangeLabels[changeType] ?? changeType;
}

export function capabilityLabel(capability: string): string {
  return capabilityLabels[capability] ?? capability;
}

export function schedulerBlockerLabel(blocker: string): string {
  return schedulerBlockerLabels[blocker] ?? blocker;
}
