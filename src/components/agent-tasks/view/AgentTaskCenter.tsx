import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ChevronDown,
  Bug,
  Check,
  CheckCircle2,
  Clock3,
  Copy,
  FileCode2,
  FileText,
  GitCompareArrows,
  Loader2,
  Maximize2,
  MessageSquarePlus,
  PanelRightOpen,
  PauseCircle,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Settings2,
  Square,
  TerminalSquare,
  TestTube2,
  Trash2,
  XCircle,
} from 'lucide-react';

import type { Project } from '../../../types/app';
import { usePaletteOps } from '../../../contexts/PaletteOpsContext';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogTitle,
  Input,
  ScrollArea,
} from '../../../shared/view/ui';
import { authenticatedFetch } from '../../../utils/api';
import { copyTextToClipboard } from '../../../utils/clipboard';
import { Markdown } from '../../chat/view/subcomponents/Markdown';

type AttemptStatus =
  | 'PENDING'
  | 'STARTING'
  | 'RUNNING'
  | 'WAITING_APPROVAL'
  | 'CANCELLING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'ABORTED';

type ResolutionStatus =
  | 'OPEN'
  | 'IN_PROGRESS'
  | 'WAITING_ACCEPTANCE'
  | 'NEEDS_FOLLOW_UP'
  | 'RESOLVED'
  | 'CLOSED';

type AcceptanceDecision = 'RESOLVED' | 'NEEDS_FOLLOW_UP' | 'CLOSED';

type AgentTask = {
  taskId: string;
  projectId: string;
  profileId: string;
  title: string;
  objective: string;
  status: AttemptStatus;
  attemptStatus: AttemptStatus;
  resolutionStatus: ResolutionStatus;
  attemptId: string | null;
  attemptNumber: number | null;
  runtimeRunId: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
};

type TaskAttempt = {
  attemptId: string;
  attemptNumber: number;
  runtimeRunId: string | null;
  status: AttemptStatus;
  executor: string | null;
  modelAlias: string | null;
  connectionRef: string | null;
  approvalMode: ApprovalMode | null;
  requestedApprovalMode: ApprovalMode | null;
  startedAt: string | null;
  completedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  followUpId: string | null;
  parentAttemptId: string | null;
  followUpFeedback: string | null;
  requestedAcceptance: string | null;
  acceptanceDecision: AcceptanceDecision | null;
  acceptanceReason: string | null;
  acceptanceAt: string | null;
};

type TaskFollowUp = {
  id: string;
  taskId: string;
  parentAttemptId: string;
  attemptId: string;
  clientRequestId: string;
  actor: string;
  feedback: string;
  requestedAcceptance: string;
  additionalContext: Record<string, unknown>;
  attemptNumber: number;
  attemptStatus: AttemptStatus;
  errorCode: string | null;
  errorMessage: string | null;
  acceptanceDecision: AcceptanceDecision | null;
  acceptanceReason: string | null;
  acceptanceAt: string | null;
  createdAt: string;
};

type Approval = {
  id: string;
  taskId: string;
  attemptId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  riskLevel: string;
  status: string;
};

type TaskEvent = {
  id: number;
  eventId: string;
  attemptId: string;
  sequenceNo: number;
  eventType: string;
  payload: Record<string, unknown>;
  occurredAt: string;
};

type ArtifactType = 'SUMMARY' | 'FILE_CHANGE' | 'GIT_DIFF' | 'TEST_REPORT' | 'ERROR_REPORT';

type TaskArtifact = {
  id: string;
  taskId: string;
  attemptId: string;
  artifactType: ArtifactType;
  producer: string;
  contentPlain: string | null;
  storagePath: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  hash: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

type ProjectRegistration = {
  projectId: string;
  profileId: string;
  projectRef: string;
  profileName: string;
};

type RuntimeConnection = {
  id: string;
  name: string;
  defaultModel: string | null;
  enabled: boolean;
};

type Executor = 'claude' | 'codex' | 'opencode';
type ApprovalMode = 'MANUAL' | 'AUTO_SAFE' | 'AUTO_TRUSTED';

const APPROVAL_MODE_OPTIONS: Array<{ value: ApprovalMode; label: string }> = [
  { value: 'MANUAL', label: '手动确认' },
  { value: 'AUTO_SAFE', label: '自动确认安全操作' },
  { value: 'AUTO_TRUSTED', label: '自动确认受信命令' },
];

function approvalModeLabel(mode: ApprovalMode | string | null | undefined): string {
  return APPROVAL_MODE_OPTIONS.find((option) => option.value === mode)?.label ?? '未记录';
}

function approvalModeCompactLabel(mode: ApprovalMode | string | null | undefined): string {
  switch (mode) {
    case 'MANUAL': return '手动确认';
    case 'AUTO_SAFE': return '安全操作自动确认';
    case 'AUTO_TRUSTED': return '受信命令自动确认';
    default: return '审批方式未记录';
  }
}

function approvalModeRank(mode: ApprovalMode): number {
  return mode === 'AUTO_TRUSTED' ? 2 : mode === 'AUTO_SAFE' ? 1 : 0;
}

function effectiveApprovalMode(policyMode: ApprovalMode | null | undefined, requestedMode: ApprovalMode): ApprovalMode {
  if (!policyMode || approvalModeRank(requestedMode) <= approvalModeRank(policyMode)) return requestedMode;
  return policyMode;
}

function approvalModeOptionsForPolicy(
  policyMode: ApprovalMode | null | undefined,
): Array<{ value: ApprovalMode; label: string; disabled: boolean }> {
  return APPROVAL_MODE_OPTIONS.map((option) => {
    const disabled = Boolean(policyMode && effectiveApprovalMode(policyMode, option.value) !== option.value);
    return {
      ...option,
      disabled,
      label: disabled ? `${option.label}（需先调整项目策略）` : option.label,
    };
  });
}

function userFacingAttemptError(errorCode: string | null, errorMessage: string | null): string | null {
  if (errorCode === 'RUNTIME_AUTH_NOT_CONFIGURED' || errorMessage?.includes('ZS_RUNTIME_TOKEN')) {
    return 'Control Plane 与执行服务的认证配置缺失，请重启知枢服务后再试。';
  }
  return errorMessage;
}

type ProjectApprovalPolicy = {
  projectId: string;
  projectRoot: string;
  mode: ApprovalMode;
  allowedDirectories: string[];
  trustedCommands: string[][];
  approvalTimeoutSeconds: number;
  updatedAt: string;
};

type ProviderModelOption = {
  value: string;
  label: string;
};

type ProviderModelCatalog = {
  options: ProviderModelOption[];
  defaultModel: string;
};

const EXECUTOR_OPTIONS: Array<{ value: Executor; label: string }> = [
  { value: 'claude', label: 'Claude Code' },
  { value: 'codex', label: 'Codex' },
  { value: 'opencode', label: 'OpenCode' },
];

function executorLabel(executor: string | null): string {
  const normalized = executor?.toLowerCase() ?? '';
  return EXECUTOR_OPTIONS.find((option) => option.value === normalized)?.label ?? (executor || 'Claude Code');
}

function executorValue(executor: string | null | undefined, fallback: Executor = 'claude'): Executor {
  const normalized = executor?.toLowerCase();
  return normalized === 'claude' || normalized === 'codex' || normalized === 'opencode'
    ? normalized
    : fallback;
}

type AgentTaskCenterProps = {
  project: Project;
};

const CONTROL_BASE_URL = String(import.meta.env.VITE_ZHISHU_CONTROL_BASE_URL ?? 'http://127.0.0.1:8080')
  .replace(/\/+$/, '');

const ACTIVE_STATUSES = new Set<AttemptStatus>([
  'PENDING', 'STARTING', 'RUNNING', 'WAITING_APPROVAL', 'CANCELLING',
]);

const ARTIFACT_TYPES: Array<{ value: ArtifactType; label: string }> = [
  { value: 'SUMMARY', label: '任务总结' },
  { value: 'FILE_CHANGE', label: '文件变更' },
  { value: 'GIT_DIFF', label: 'Git Diff' },
  { value: 'TEST_REPORT', label: '测试报告' },
  { value: 'ERROR_REPORT', label: '错误报告' },
];

const TASK_TEMPLATES = [
  {
    label: '修复问题',
    title: '修复当前项目中的一个明确问题',
    objective: '先分析项目并选择一个影响实际行为、范围可控且可以验证的问题；说明根因后只修改相关文件，运行最小相关测试，并输出改动与验证结果。不要做配色、格式化、改名等无业务价值的调整。',
  },
  {
    label: '只读审查',
    title: '审查当前项目的可靠性风险',
    objective: '只读审查当前项目，重点检查错误处理、并发、幂等、资源释放和数据一致性。不要修改文件或执行破坏性命令；按严重程度输出问题、证据位置和修复建议。',
  },
  {
    label: '补充测试',
    title: '为薄弱模块补充有效测试',
    objective: '分析现有测试覆盖，选择一个存在明确风险但覆盖不足的模块，补充边界、失败路径和回归测试。不要改变无关业务行为，最后运行相关测试并报告结果。',
  },
  {
    label: '故障排查',
    title: '排查当前项目最近的运行故障',
    objective: '检查项目配置、健康状态和最近日志，定位一个真实运行故障的根因。先只读诊断；如需修改必须说明影响并等待审批，最后给出复现、修复和验证结果。',
  },
] as const;

const READ_ONLY_TOOL_NAMES = new Set(['Read', 'Glob', 'Grep', 'LS', 'WebSearch', 'WebFetch']);

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function fileNameFromPath(path: string | null): string | null {
  if (!path) return null;
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function artifactFileCandidate(artifact: TaskArtifact): string | null {
  const metadataPath = readString(artifact.metadata, 'path')
    ?? readString(artifact.metadata, 'filePath')
    ?? readString(artifact.metadata, 'file_path');
  if (metadataPath) return metadataPath;

  const contentMatch = artifact.contentPlain?.match(
    /(?:^|\n)(?:Write|Edit|NotebookEdit|Create|Created|Add|Added|Update|Updated|Modify|Modified):\s*([^\r\n]+)/i,
  );
  return contentMatch?.[1]?.trim() || null;
}

function projectRelativeArtifactPath(artifact: TaskArtifact, projectRoot: string): string | null {
  const candidate = artifactFileCandidate(artifact)
    ?.trim()
    .replace(/^[`"']+|[`"']+$/g, '')
    .replace(/\\/g, '/');
  if (!candidate) return null;

  const root = projectRoot.trim().replace(/\\/g, '/').replace(/\/+$/, '');
  const windowsAbsolute = /^[a-z]:\//i.test(candidate);
  const absolute = windowsAbsolute || candidate.startsWith('/');
  let relative = candidate;

  if (absolute) {
    if (!root) return null;
    const comparableCandidate = windowsAbsolute ? candidate.toLowerCase() : candidate;
    const comparableRoot = windowsAbsolute ? root.toLowerCase() : root;
    if (!comparableCandidate.startsWith(`${comparableRoot}/`)) return null;
    relative = candidate.slice(root.length + 1);
  }

  const segments = relative.replace(/^\.\//, '').split('/').filter((segment) => segment && segment !== '.');
  if (!segments.length || segments.some((segment) => segment === '..')) return null;
  return segments.join('/');
}

function toolPresentation(toolName: string, input: Record<string, unknown>) {
  const filePath = readString(input, 'file_path') ?? readString(input, 'path');
  const command = readString(input, 'command');
  if (toolName === 'Edit' || toolName === 'Write') {
    return {
      action: toolName === 'Edit' ? '修改文件' : '写入文件',
      target: filePath,
      reason: '这会改变项目代码或文件内容，需要你确认。',
    };
  }
  if (toolName === 'Bash' || toolName === 'Shell') {
    return {
      action: '执行终端命令',
      target: command,
      reason: '命令会在项目目录中运行，可能读取或改变本机文件。',
    };
  }
  if (READ_ONLY_TOOL_NAMES.has(toolName)) {
    return { action: '读取项目信息', target: filePath, reason: '这是只读操作，不会修改项目。' };
  }
  return { action: `调用 ${toolName}`, target: filePath ?? command, reason: '该工具需要你的确认后才能继续。' };
}

function approvalDiff(input: Record<string, unknown>) {
  const oldString = readString(input, 'old_string');
  const newString = readString(input, 'new_string') ?? readString(input, 'content');
  return { oldString, newString };
}

type ApprovalFileChange = {
  path: string;
  kind: string | null;
  diff: string | null;
};

function approvalFileChanges(input: Record<string, unknown>): ApprovalFileChange[] {
  if (!Array.isArray(input.changes)) return [];
  return input.changes.flatMap((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const change = value as Record<string, unknown>;
    const path = readString(change, 'path') ?? readString(change, 'filePath');
    if (!path) return [];
    return [{
      path,
      kind: readString(change, 'kind'),
      diff: readString(change, 'diff'),
    }];
  });
}

function changeKindLabel(kind: string | null): string {
  switch (kind?.toLowerCase()) {
    case 'add': return '新增';
    case 'delete': return '删除';
    case 'update': return '修改';
    case 'move': return '移动';
    default: return kind ?? '变更';
  }
}

function isPermissionTimeout(artifact: TaskArtifact): boolean {
  return artifact.artifactType === 'ERROR_REPORT'
    && artifact.contentPlain?.toLowerCase().includes('permission request timed out') === true;
}

type ArtifactGroup = {
  key: string;
  representative: TaskArtifact;
  count: number;
};

function groupArtifacts(rows: TaskArtifact[]): ArtifactGroup[] {
  const groups = new Map<string, ArtifactGroup>();
  for (const artifact of rows) {
    const toolName = typeof artifact.metadata.toolName === 'string' ? artifact.metadata.toolName : '';
    const key = `${artifact.artifactType}:${artifact.contentPlain ?? ''}:${toolName}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      groups.set(key, { key, representative: artifact, count: 1 });
    }
  }
  return [...groups.values()];
}

type TimelineTone = 'blue' | 'amber' | 'green' | 'red' | 'slate';

type TimelineItem = {
  key: string;
  title: string;
  detail: string | null;
  tone: TimelineTone;
  occurredAt: string;
  sequenceNo: number;
  events: TaskEvent[];
};

function timelinePresentation(event: TaskEvent): Omit<TimelineItem, 'key' | 'events'> | null {
  const payload = event.payload;
  const toolName = readString(payload, 'toolName');
  const toolInput = payload.toolInput && typeof payload.toolInput === 'object'
    ? payload.toolInput as Record<string, unknown>
    : {};
  const decision = readString(payload, 'decision');
  const artifactType = readString(payload, 'artifactType') as ArtifactType | null;

  switch (event.eventType) {
    case 'RUN_STARTED':
      return { title: `已启动 ${executorLabel(readString(payload, 'executor'))} 执行器`, detail: 'Agent 开始读取项目并执行任务目标。', tone: 'blue', occurredAt: event.occurredAt, sequenceNo: event.sequenceNo };
    case 'AGENT_STATUS': {
      const kind = readString(payload, 'kind');
      const text = readString(payload, 'text');
      if (text === 'token_budget') return null;
      if (kind === 'tool_use' && toolName) {
        const tool = toolPresentation(toolName, toolInput);
        return { title: `正在${tool.action}`, detail: tool.target, tone: 'blue', occurredAt: event.occurredAt, sequenceNo: event.sequenceNo };
      }
      return text
        ? { title: 'Agent 更新了执行状态', detail: text, tone: 'slate', occurredAt: event.occurredAt, sequenceNo: event.sequenceNo }
        : null;
    }
    case 'APPROVAL_REQUIRED': {
      const tool = toolPresentation(toolName ?? '工具', toolInput);
      return { title: `需要你确认：${tool.action}`, detail: tool.target, tone: 'amber', occurredAt: event.occurredAt, sequenceNo: event.sequenceNo };
    }
    case 'APPROVAL_RESOLVED':
      if (decision === 'AUTO_APPROVED') return {
        title: '已按规则自动批准',
        detail: [readString(payload, 'rule'), readString(payload, 'reason')].filter(Boolean).join('：') || null,
        tone: 'green', occurredAt: event.occurredAt, sequenceNo: event.sequenceNo,
      };
      if (decision === 'APPROVED') return { title: '你已允许本次操作', detail: null, tone: 'green', occurredAt: event.occurredAt, sequenceNo: event.sequenceNo };
      if (decision === 'DENIED') return { title: '你已拒绝本次操作', detail: readString(payload, 'reason'), tone: 'red', occurredAt: event.occurredAt, sequenceNo: event.sequenceNo };
      if (decision === 'EXPIRED') return { title: '审批等待超时', detail: 'Agent 在等待时间内没有收到决定，本次操作未执行。', tone: 'amber', occurredAt: event.occurredAt, sequenceNo: event.sequenceNo };
      return { title: '审批已处理', detail: decision, tone: 'slate', occurredAt: event.occurredAt, sequenceNo: event.sequenceNo };
    case 'COMMAND_COMPLETED': {
      const failed = payload.isError === true;
      return { title: `${toolName ?? '工具'}${failed ? ' 未执行成功' : ' 已执行完成'}`, detail: failed ? '可在任务产物中查看原因。' : null, tone: failed ? 'red' : 'green', occurredAt: event.occurredAt, sequenceNo: event.sequenceNo };
    }
    case 'ARTIFACT_PUBLISHED':
      return { title: `已生成${artifactType ? artifactPresentation(artifactType).label : '任务产物'}`, detail: null, tone: artifactType === 'ERROR_REPORT' ? 'red' : 'green', occurredAt: event.occurredAt, sequenceNo: event.sequenceNo };
    case 'ERROR':
      return { title: '执行遇到错误', detail: readString(payload, 'message') ?? readString(payload, 'error'), tone: 'red', occurredAt: event.occurredAt, sequenceNo: event.sequenceNo };
    case 'RUN_COMPLETED':
      return { title: 'Agent 执行已结束', detail: payload.exitCode === 0 ? '执行器正常退出，结果已归档。' : `退出码：${String(payload.exitCode)}`, tone: payload.exitCode === 0 ? 'green' : 'red', occurredAt: event.occurredAt, sequenceNo: event.sequenceNo };
    case 'RUN_FAILED':
      return { title: '任务执行失败', detail: readString(payload, 'message') ?? readString(payload, 'error'), tone: 'red', occurredAt: event.occurredAt, sequenceNo: event.sequenceNo };
    case 'RUN_ABORTED':
      return { title: '任务已被取消', detail: readString(payload, 'reason'), tone: 'slate', occurredAt: event.occurredAt, sequenceNo: event.sequenceNo };
    default:
      return { title: event.eventType, detail: null, tone: 'slate', occurredAt: event.occurredAt, sequenceNo: event.sequenceNo };
  }
}

function buildReadableTimeline(events: TaskEvent[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  for (const event of events) {
    const presentation = timelinePresentation(event);
    if (!presentation) continue;
    const previous = items.at(-1);
    const compactKey = `${presentation.title}:${presentation.detail ?? ''}`;
    if (previous && previous.key === compactKey) {
      previous.events.push(event);
      previous.occurredAt = event.occurredAt;
      previous.sequenceNo = event.sequenceNo;
      continue;
    }
    items.push({ ...presentation, key: compactKey, events: [event] });
  }
  return items;
}

function toneClasses(tone: TimelineTone) {
  switch (tone) {
    case 'amber': return { dot: 'bg-amber-500', border: 'border-amber-200 dark:border-amber-900/70', icon: 'text-amber-600' };
    case 'green': return { dot: 'bg-emerald-500', border: 'border-emerald-200 dark:border-emerald-900/70', icon: 'text-emerald-600' };
    case 'red': return { dot: 'bg-red-500', border: 'border-red-200 dark:border-red-900/70', icon: 'text-red-600' };
    case 'blue': return { dot: 'bg-blue-500', border: 'border-blue-200 dark:border-blue-900/70', icon: 'text-blue-600' };
    default: return { dot: 'bg-slate-400', border: 'border-border', icon: 'text-slate-500' };
  }
}

function artifactPresentation(type: ArtifactType) {
  switch (type) {
    case 'FILE_CHANGE': return { label: '文件变更', tone: 'text-blue-600', Icon: FileCode2 };
    case 'GIT_DIFF': return { label: 'Git Diff', tone: 'text-violet-600', Icon: GitCompareArrows };
    case 'TEST_REPORT': return { label: '测试报告', tone: 'text-emerald-600', Icon: TestTube2 };
    case 'ERROR_REPORT': return { label: '错误报告', tone: 'text-red-600', Icon: Bug };
    default: return { label: '任务总结', tone: 'text-amber-600', Icon: FileText };
  }
}

function statusPresentation(status: AttemptStatus) {
  switch (status) {
    case 'SUCCEEDED': return { label: '已完成', tone: 'text-emerald-600', Icon: CheckCircle2 };
    case 'FAILED': return { label: '失败', tone: 'text-red-600', Icon: XCircle };
    case 'ABORTED': return { label: '已取消', tone: 'text-slate-500', Icon: Square };
    case 'WAITING_APPROVAL': return { label: '等待审批', tone: 'text-amber-600', Icon: ShieldAlert };
    case 'CANCELLING': return { label: '取消中', tone: 'text-orange-600', Icon: Loader2 };
    case 'RUNNING': return { label: '运行中', tone: 'text-blue-600', Icon: Play };
    case 'STARTING': return { label: '启动中', tone: 'text-indigo-600', Icon: Loader2 };
    default: return { label: '排队中', tone: 'text-slate-500', Icon: Clock3 };
  }
}

function resolutionPresentation(status: ResolutionStatus) {
  switch (status) {
    case 'RESOLVED': return { label: '问题已解决', tone: 'text-emerald-600', background: 'bg-emerald-50 dark:bg-emerald-950/30' };
    case 'WAITING_ACCEPTANCE': return { label: '等待验收', tone: 'text-amber-700 dark:text-amber-300', background: 'bg-amber-50 dark:bg-amber-950/30' };
    case 'NEEDS_FOLLOW_UP': return { label: '需要跟进', tone: 'text-orange-700 dark:text-orange-300', background: 'bg-orange-50 dark:bg-orange-950/30' };
    case 'CLOSED': return { label: '已关闭', tone: 'text-slate-500', background: 'bg-slate-100 dark:bg-slate-900/40' };
    case 'IN_PROGRESS': return { label: '处理中', tone: 'text-blue-600', background: 'bg-blue-50 dark:bg-blue-950/30' };
    default: return { label: '待处理', tone: 'text-slate-500', background: 'bg-slate-100 dark:bg-slate-900/40' };
  }
}

function acceptanceLabel(decision: AcceptanceDecision | null): string | null {
  if (decision === 'RESOLVED') return '验收通过';
  if (decision === 'NEEDS_FOLLOW_UP') return '验收未通过';
  if (decision === 'CLOSED') return '任务已关闭';
  return null;
}

function projectCandidateId(projectRef: string): string {
  const key = `zhishu-control-project:${projectRef}`;
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const created = crypto.randomUUID();
  localStorage.setItem(key, created);
  return created;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${CONTROL_BASE_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { message?: string };
    throw new Error(body.message || `Control Plane request failed (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

async function loadProviderModelCatalog(executor: Exclude<Executor, 'claude'>): Promise<ProviderModelCatalog> {
  const response = await authenticatedFetch(`/api/providers/${executor}/models`);
  const body = await response.json() as {
    success?: boolean;
    data?: { models?: { OPTIONS?: ProviderModelOption[]; DEFAULT?: string } };
  };
  if (!response.ok || !body.success || !body.data?.models) throw new Error('模型目录不可用');
  return {
    options: body.data.models.OPTIONS ?? [],
    defaultModel: body.data.models.DEFAULT ?? '',
  };
}

export default function AgentTaskCenter({ project }: AgentTaskCenterProps) {
  const projectRef = project.fullPath || project.path || '';
  const { openFileInEditor } = usePaletteOps();
  const [registration, setRegistration] = useState<ProjectRegistration | null>(null);
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [attempts, setAttempts] = useState<TaskAttempt[]>([]);
  const [followUps, setFollowUps] = useState<TaskFollowUp[]>([]);
  const [selectedAttemptId, setSelectedAttemptId] = useState<string | null>(null);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [artifacts, setArtifacts] = useState<TaskArtifact[]>([]);
  const [artifactFilter, setArtifactFilter] = useState<ArtifactType | 'ALL'>('ALL');
  const [previewArtifact, setPreviewArtifact] = useState<TaskArtifact | null>(null);
  const [copiedArtifactId, setCopiedArtifactId] = useState<string | null>(null);
  const [title, setTitle] = useState<string>(TASK_TEMPLATES[0].title);
  const [objective, setObjective] = useState<string>(TASK_TEMPLATES[0].objective);
  const [connections, setConnections] = useState<RuntimeConnection[]>([]);
  const [connectionRef, setConnectionRef] = useState('');
  const [executor, setExecutor] = useState<Executor>('claude');
  const [model, setModel] = useState('');
  const [modelOptions, setModelOptions] = useState<ProviderModelOption[]>([]);
  const [defaultModel, setDefaultModel] = useState('');
  const [modelsLoading, setModelsLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTechnicalEvents, setShowTechnicalEvents] = useState(false);
  const [deleteCandidate, setDeleteCandidate] = useState<AgentTask | null>(null);
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [followUpFeedback, setFollowUpFeedback] = useState('');
  const [followUpAcceptance, setFollowUpAcceptance] = useState('');
  const [followUpContext, setFollowUpContext] = useState('');
  const [followUpRequestId, setFollowUpRequestId] = useState('');
  const [followUpExecutor, setFollowUpExecutor] = useState<Executor>('claude');
  const [followUpConnectionRef, setFollowUpConnectionRef] = useState('');
  const [followUpModel, setFollowUpModel] = useState('');
  const [followUpModelOptions, setFollowUpModelOptions] = useState<ProviderModelOption[]>([]);
  const [followUpDefaultModel, setFollowUpDefaultModel] = useState('');
  const [followUpModelsLoading, setFollowUpModelsLoading] = useState(false);
  const [followUpApprovalMode, setFollowUpApprovalMode] = useState<ApprovalMode>('MANUAL');
  const [acceptanceDecision, setAcceptanceDecision] = useState<AcceptanceDecision | null>(null);
  const [acceptanceReason, setAcceptanceReason] = useState('');
  const [acceptanceRequestId, setAcceptanceRequestId] = useState('');
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>('MANUAL');
  const [approvalPolicy, setApprovalPolicy] = useState<ProjectApprovalPolicy | null>(null);
  const [approvalPolicyOpen, setApprovalPolicyOpen] = useState(false);
  const [approvalPolicyModeBeforeDialog, setApprovalPolicyModeBeforeDialog] = useState<ApprovalMode | null>(null);
  const [returnToFollowUpAfterPolicy, setReturnToFollowUpAfterPolicy] = useState(false);
  const [policyDirectories, setPolicyDirectories] = useState('.');
  const [policyCommands, setPolicyCommands] = useState('');
  const [policyTimeout, setPolicyTimeout] = useState('45');

  const selectedTask = useMemo(
    () => tasks.find((task) => task.taskId === selectedId) ?? null,
    [selectedId, tasks],
  );
  const selectedTaskId = selectedTask?.taskId ?? null;
  const selectedAttempt = attempts.find((attempt) => attempt.attemptId === selectedAttemptId)
    ?? attempts.find((attempt) => attempt.attemptId === selectedTask?.attemptId)
    ?? attempts[0]
    ?? null;
  const controlProjectId = registration?.projectId ?? null;
  const attemptArtifacts = useMemo(
    () => selectedAttempt ? artifacts.filter((artifact) => artifact.attemptId === selectedAttempt.attemptId) : artifacts,
    [artifacts, selectedAttempt],
  );
  const visibleArtifacts = useMemo(
    () => artifactFilter === 'ALL'
      ? attemptArtifacts
      : attemptArtifacts.filter((artifact) => artifact.artifactType === artifactFilter),
    [artifactFilter, attemptArtifacts],
  );
  const groupedArtifacts = useMemo(() => groupArtifacts(visibleArtifacts), [visibleArtifacts]);
  const previewArtifactFilePath = useMemo(
    () => previewArtifact?.artifactType === 'FILE_CHANGE'
      ? projectRelativeArtifactPath(previewArtifact, projectRef)
      : null,
    [previewArtifact, projectRef],
  );
  const selectedEvents = useMemo(
    () => selectedAttempt ? events.filter((event) => event.attemptId === selectedAttempt.attemptId) : events,
    [events, selectedAttempt],
  );
  const selectedApprovals = useMemo(
    () => selectedAttempt
      ? approvals.filter((approval) => approval.attemptId === selectedAttempt.attemptId)
      : approvals,
    [approvals, selectedAttempt],
  );
  const readableTimeline = useMemo(() => buildReadableTimeline(selectedEvents), [selectedEvents]);
  const permissionTimeoutCount = useMemo(
    () => visibleArtifacts.filter(isPermissionTimeout).length,
    [visibleArtifacts],
  );
  const currentStep = useMemo(() => {
    if (!selectedTask || !selectedAttempt) return null;
    if (selectedAttempt.status === 'WAITING_APPROVAL' && selectedAttempt.attemptId === selectedTask.attemptId) {
      const approval = selectedApprovals[0];
      if (approval) {
        const tool = toolPresentation(approval.toolName, approval.toolInput);
        return {
          title: `等待你确认：${tool.action}`,
          detail: tool.target ? `目标：${tool.target}` : '确认后 Agent 才能继续执行。',
          tone: 'amber' as TimelineTone,
        };
      }
      return { title: '正在等待审批', detail: '审批请求正在同步，请稍候。', tone: 'amber' as TimelineTone };
    }
    if (selectedAttempt.status === 'RUNNING' || selectedAttempt.status === 'STARTING') {
      const latest = readableTimeline.at(-1);
      return {
        title: latest?.title ?? 'Agent 正在分析项目',
        detail: latest?.detail ?? '执行进度会实时显示在下方。',
        tone: latest?.tone ?? 'blue' as TimelineTone,
      };
    }
    if (selectedAttempt.status === 'SUCCEEDED' && permissionTimeoutCount > 0) {
      return {
        title: 'Agent 已结束，但部分操作未完成',
        detail: `${permissionTimeoutCount} 次操作因审批超时未执行，请查看总结后决定是否重试。`,
        tone: 'amber' as TimelineTone,
      };
    }
    if (selectedTask.resolutionStatus === 'WAITING_ACCEPTANCE' && selectedAttempt.status === 'SUCCEEDED') {
      return null;
    }
    const presentation = statusPresentation(selectedAttempt.status);
      return {
        title: `第 ${selectedAttempt.attemptNumber} 次执行：${presentation.label}`,
        detail: userFacingAttemptError(selectedAttempt.errorCode, selectedAttempt.errorMessage)
          || (selectedAttempt.status === 'SUCCEEDED' ? 'Agent 已完成执行，请确认问题是否解决。' : '可查看下方执行记录。'),
        tone: selectedAttempt.status === 'SUCCEEDED' ? 'green' as TimelineTone : selectedAttempt.status === 'FAILED' ? 'red' as TimelineTone : 'slate' as TimelineTone,
      };
  }, [permissionTimeoutCount, readableTimeline, selectedApprovals, selectedAttempt, selectedTask]);

  const loadTasks = useCallback(async (controlProjectId: string) => {
    const rows = await requestJson<AgentTask[]>(`/api/v1/tasks?projectId=${controlProjectId}&limit=100`);
    setTasks(rows);
    setSelectedId((current) => current && rows.some((task) => task.taskId === current)
      ? current
      : rows[0]?.taskId ?? null);
  }, []);

  const loadArtifacts = useCallback(async (taskId: string) => {
    const rows = await requestJson<TaskArtifact[]>(`/api/v1/tasks/${taskId}/artifacts`);
    setArtifacts(rows);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setRegistration(null);
    void requestJson<ProjectRegistration>('/api/v1/projects/ensure', {
      method: 'POST',
      body: JSON.stringify({
        candidateProjectId: projectCandidateId(projectRef),
        projectRef,
        displayName: project.displayName,
      }),
    }).then(async (result) => {
      if (cancelled) return;
      setRegistration(result);
      try {
        const policy = await requestJson<ProjectApprovalPolicy>(`/api/v1/projects/${result.projectId}/approval-policy`);
        if (cancelled) return;
        setApprovalPolicy(policy);
        setApprovalMode(policy.mode);
        setPolicyDirectories(policy.allowedDirectories.join('\n'));
        setPolicyCommands(policy.trustedCommands.map((command) => command.join(' ')).join('\n'));
        setPolicyTimeout(String(policy.approvalTimeoutSeconds));
      } catch (reason) {
        if (!(reason instanceof Error) || !reason.message.includes('(404)')) throw reason;
        if (cancelled) return;
        setApprovalPolicy({
          projectId: result.projectId,
          projectRoot: projectRef,
          mode: 'MANUAL',
          allowedDirectories: ['.'],
          trustedCommands: [],
          approvalTimeoutSeconds: 45,
          updatedAt: new Date().toISOString(),
        });
        setApprovalMode('MANUAL');
        setPolicyDirectories('.');
        setPolicyCommands('');
        setPolicyTimeout('45');
      }
      await loadTasks(result.projectId);
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => { cancelled = true; };
  }, [loadTasks, project.displayName, projectRef]);

  useEffect(() => {
    void authenticatedFetch('/api/runtime-connections')
      .then((response) => response.ok ? response.json() : { connections: [] })
      .then((body: { connections?: RuntimeConnection[] }) => setConnections((body.connections ?? []).filter((item) => item.enabled)))
      .catch(() => setConnections([]));
  }, []);

  useEffect(() => {
    setModel('');
    setModelOptions([]);
    setDefaultModel('');
    if (executor === 'claude') return undefined;

    let cancelled = false;
    setModelsLoading(true);
    void loadProviderModelCatalog(executor)
      .then((catalog) => {
        if (!cancelled) {
          setModelOptions(catalog.options);
          setDefaultModel(catalog.defaultModel);
          setModel(catalog.defaultModel);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setModelOptions([]);
          setDefaultModel('');
        }
      })
      .finally(() => { if (!cancelled) setModelsLoading(false); });
    return () => { cancelled = true; };
  }, [executor]);

  useEffect(() => {
    setFollowUpModelOptions([]);
    setFollowUpDefaultModel('');
    if (!followUpOpen || followUpExecutor === 'claude') {
      setFollowUpModelsLoading(false);
      return undefined;
    }

    let cancelled = false;
    setFollowUpModelsLoading(true);
    void loadProviderModelCatalog(followUpExecutor)
      .then((catalog) => {
        if (!cancelled) {
          setFollowUpModelOptions(catalog.options);
          setFollowUpDefaultModel(catalog.defaultModel);
          setFollowUpModel((current) => current || catalog.defaultModel);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFollowUpModelOptions([]);
          setFollowUpDefaultModel('');
        }
      })
      .finally(() => { if (!cancelled) setFollowUpModelsLoading(false); });
    return () => { cancelled = true; };
  }, [followUpExecutor, followUpOpen]);

  useEffect(() => {
    if (!selectedTaskId) {
      setEvents([]);
      setApprovals([]);
      setAttempts([]);
      setFollowUps([]);
      setSelectedAttemptId(null);
      setArtifacts([]);
      return undefined;
    }
    setEvents([]);
    void requestJson<Approval[]>(`/api/v1/tasks/${selectedTaskId}/approvals`)
      .then(setApprovals)
      .catch(() => setApprovals([]));
    void requestJson<TaskAttempt[]>(`/api/v1/tasks/${selectedTaskId}/attempts`)
      .then((rows) => {
        setAttempts(rows);
        setSelectedAttemptId((current) => current && rows.some((attempt) => attempt.attemptId === current)
          ? current
          : selectedTask?.attemptId ?? rows[0]?.attemptId ?? null);
      })
      .catch(() => setAttempts([]));
    void requestJson<TaskFollowUp[]>(`/api/v1/tasks/${selectedTaskId}/follow-ups`)
      .then(setFollowUps)
      .catch(() => setFollowUps([]));
    void loadArtifacts(selectedTaskId).catch(() => setArtifacts([]));
    const stream = new EventSource(`${CONTROL_BASE_URL}/api/v1/tasks/${selectedTaskId}/events`);
    const handleEvent = (message: MessageEvent<string>) => {
      const event = JSON.parse(message.data) as TaskEvent;
      setEvents((current) => current.some((item) => item.id === event.id)
        ? current
        : [...current, event].sort((a, b) => a.id - b.id));
      if (controlProjectId) void loadTasks(controlProjectId);
      void requestJson<Approval[]>(`/api/v1/tasks/${selectedTaskId}/approvals`)
        .then(setApprovals)
        .catch(() => undefined);
      void requestJson<TaskAttempt[]>(`/api/v1/tasks/${selectedTaskId}/attempts`)
        .then(setAttempts)
        .catch(() => undefined);
      void requestJson<TaskFollowUp[]>(`/api/v1/tasks/${selectedTaskId}/follow-ups`)
        .then(setFollowUps)
        .catch(() => undefined);
      if (event.eventType === 'ARTIFACT_PUBLISHED') {
        void loadArtifacts(selectedTaskId).catch(() => undefined);
      }
    };
    const eventTypes = [
      'RUN_STARTED', 'AGENT_STATUS', 'COMMAND_COMPLETED', 'ARTIFACT_PUBLISHED', 'APPROVAL_REQUIRED',
      'APPROVAL_RESOLVED', 'ERROR', 'RUN_COMPLETED', 'RUN_FAILED', 'RUN_ABORTED',
    ];
    eventTypes.forEach((eventType) => stream.addEventListener(eventType, handleEvent as EventListener));
    return () => {
      eventTypes.forEach((eventType) => stream.removeEventListener(eventType, handleEvent as EventListener));
      stream.close();
    };
  }, [controlProjectId, loadArtifacts, loadTasks, selectedTask?.attemptId, selectedTaskId]);

  const runMutation = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await operation();
      if (registration) await loadTasks(registration.projectId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const createTask = () => runMutation(async () => {
    if (!registration) throw new Error('控制面项目尚未初始化');
    const created = await requestJson<AgentTask>('/api/v1/tasks', {
      method: 'POST',
      body: JSON.stringify({
        projectId: registration.projectId,
        profileId: registration.profileId,
        title,
        objective,
        executor,
        connectionRef: executor === 'claude' && connectionRef ? connectionRef : null,
        modelAlias: executor !== 'claude' && model.trim() ? model.trim() : null,
        approvalMode,
      }),
    });
    setSelectedId(created.taskId);
  });

  const openApprovalPolicy = () => {
    setApprovalPolicyModeBeforeDialog(approvalPolicy?.mode ?? null);
    setApprovalPolicyOpen(true);
  };

  const closeApprovalPolicy = () => {
    if (busy) return;
    const shouldReturnToFollowUp = returnToFollowUpAfterPolicy;
    if (approvalPolicyModeBeforeDialog) {
      setApprovalPolicy((current) => current && ({ ...current, mode: approvalPolicyModeBeforeDialog }));
    }
    setApprovalPolicyModeBeforeDialog(null);
    setReturnToFollowUpAfterPolicy(false);
    setApprovalPolicyOpen(false);
    if (shouldReturnToFollowUp) setFollowUpOpen(true);
  };

  const openApprovalPolicyFromFollowUp = () => {
    if (!approvalPolicy) return;
    setApprovalPolicyModeBeforeDialog(approvalPolicy.mode);
    setApprovalPolicy((current) => current && ({ ...current, mode: followUpApprovalMode }));
    setReturnToFollowUpAfterPolicy(true);
    setFollowUpOpen(false);
    setApprovalPolicyOpen(true);
  };

  const saveApprovalPolicy = () => runMutation(async () => {
    if (!registration || !approvalPolicy) throw new Error('控制面项目尚未初始化');
    const trustedCommands = policyCommands.split(/\r?\n/).map((line) => (
      line.match(/"[^"]*"|'[^']*'|\S+/g)?.map((token) => token.replace(/^("|')|("|')$/g, '')) ?? []
    )).filter((command) => command.length > 0);
    const updated = await requestJson<ProjectApprovalPolicy>(
      `/api/v1/projects/${registration.projectId}/approval-policy`,
      {
        method: 'PUT',
        body: JSON.stringify({
          mode: approvalPolicy.mode,
          allowedDirectories: policyDirectories.split(/\r?\n/).map((value) => value.trim()).filter(Boolean),
          trustedCommands,
          approvalTimeoutSeconds: Number(policyTimeout),
        }),
      },
    );
    setApprovalPolicy(updated);
    setApprovalMode(updated.mode);
    if (returnToFollowUpAfterPolicy) {
      setFollowUpApprovalMode(effectiveApprovalMode(updated.mode, followUpApprovalMode));
      setFollowUpOpen(true);
    }
    setApprovalPolicyModeBeforeDialog(null);
    setReturnToFollowUpAfterPolicy(false);
    setApprovalPolicyOpen(false);
  });

  const controlTask = (action: 'cancel' | 'retry') => runMutation(async () => {
    if (!selectedTask) return;
    await requestJson(`/api/v1/tasks/${selectedTask.taskId}/${action}`, { method: 'POST' });
  });

  const requestTaskDeletion = (task: AgentTask) => {
    if (ACTIVE_STATUSES.has(task.attemptStatus)) return;
    setError(null);
    setDeleteCandidate(task);
  };

  const confirmDeleteTask = () => {
    const task = deleteCandidate;
    if (!task || ACTIVE_STATUSES.has(task.attemptStatus)) return;
    void runMutation(async () => {
      await requestJson<void>(`/api/v1/tasks/${task.taskId}`, { method: 'DELETE' });
      if (selectedId === task.taskId) setSelectedId(null);
      setDeleteCandidate(null);
    });
  };

  const decide = (approval: Approval, decision: 'APPROVED' | 'DENIED') => runMutation(async () => {
    await requestJson(`/api/v1/approvals/${approval.id}/decision`, {
      method: 'POST',
      body: JSON.stringify({ decision }),
    });
    setApprovals((current) => current.filter((item) => item.id !== approval.id));
  });

  const refreshTaskHistory = async (taskId: string) => {
    const [attemptRows, followUpRows] = await Promise.all([
      requestJson<TaskAttempt[]>(`/api/v1/tasks/${taskId}/attempts`),
      requestJson<TaskFollowUp[]>(`/api/v1/tasks/${taskId}/follow-ups`),
      loadArtifacts(taskId),
    ]);
    setAttempts(attemptRows);
    setFollowUps(followUpRows);
  };

  const copyArtifact = async (artifact: TaskArtifact) => {
    if (!artifact.contentPlain) return;
    const copied = await copyTextToClipboard(artifact.contentPlain);
    if (!copied) {
      setError('复制产物内容失败，请稍后重试');
      return;
    }
    setCopiedArtifactId(artifact.id);
    window.setTimeout(() => {
      setCopiedArtifactId((current) => current === artifact.id ? null : current);
    }, 2000);
  };

  const openArtifactFile = (filePath: string) => {
    setError(null);
    setPreviewArtifact(null);
    openFileInEditor(filePath);
  };

  const openFollowUp = () => {
    if (!selectedTask?.attemptId || ACTIVE_STATUSES.has(selectedTask.attemptStatus)) return;
    const currentAttempt = attempts.find((attempt) => attempt.attemptId === selectedTask.attemptId);
    const nextExecutor = executorValue(executor, executorValue(currentAttempt?.executor));
    setError(null);
    setFollowUpFeedback('');
    setFollowUpAcceptance('');
    setFollowUpContext('');
    setFollowUpExecutor(nextExecutor);
    setFollowUpConnectionRef(nextExecutor === 'claude' ? connectionRef || currentAttempt?.connectionRef || '' : '');
    setFollowUpModel(nextExecutor === 'claude' ? '' : model || currentAttempt?.modelAlias || '');
    setFollowUpApprovalMode(effectiveApprovalMode(approvalPolicy?.mode, approvalMode));
    setFollowUpRequestId(crypto.randomUUID());
    setFollowUpOpen(true);
  };

  const changeFollowUpExecutor = (nextExecutor: Executor) => {
    setFollowUpExecutor(nextExecutor);
    setFollowUpConnectionRef('');
    setFollowUpModel('');
  };

  const submitFollowUp = () => runMutation(async () => {
    if (!selectedTask?.attemptId) throw new Error('当前任务没有可跟进的执行记录');
    const parentAttemptId = selectedTask.attemptId;
    if (selectedTask.resolutionStatus === 'WAITING_ACCEPTANCE') {
      await requestJson(`/api/v1/tasks/${selectedTask.taskId}/acceptance`, {
        method: 'POST',
        body: JSON.stringify({
          attemptId: parentAttemptId,
          clientRequestId: `${followUpRequestId}:acceptance`,
          actor: 'local-user',
          decision: 'NEEDS_FOLLOW_UP',
          reason: followUpFeedback.trim(),
        }),
      });
    }
    const created = await requestJson<TaskFollowUp>(`/api/v1/tasks/${selectedTask.taskId}/follow-ups`, {
      method: 'POST',
      body: JSON.stringify({
        parentAttemptId,
        clientRequestId: followUpRequestId,
        actor: 'local-user',
        feedback: followUpFeedback.trim(),
        requestedAcceptance: followUpAcceptance.trim(),
        executor: followUpExecutor,
        connectionRef: followUpExecutor === 'claude' && followUpConnectionRef ? followUpConnectionRef : null,
        modelAlias: followUpExecutor !== 'claude' && followUpModel.trim() ? followUpModel.trim() : null,
        approvalMode: followUpApprovalMode,
        additionalContext: followUpContext.trim() ? { notes: followUpContext.trim() } : {},
      }),
    });
    setSelectedAttemptId(created.attemptId);
    setFollowUpOpen(false);
    await refreshTaskHistory(selectedTask.taskId);
  });

  const openAcceptance = (decision: AcceptanceDecision) => {
    setAcceptanceDecision(decision);
    setAcceptanceReason(decision === 'RESOLVED'
      ? '用户确认 Agent 结果已解决问题'
      : decision === 'CLOSED' ? '用户关闭任务' : '结果仍需要继续修改');
    setAcceptanceRequestId(crypto.randomUUID());
  };

  const submitAcceptance = () => runMutation(async () => {
    if (!selectedTask?.attemptId || !acceptanceDecision) throw new Error('当前任务无法验收');
    await requestJson(`/api/v1/tasks/${selectedTask.taskId}/acceptance`, {
      method: 'POST',
      body: JSON.stringify({
        attemptId: selectedTask.attemptId,
        clientRequestId: acceptanceRequestId,
        actor: 'local-user',
        decision: acceptanceDecision,
        reason: acceptanceReason.trim(),
      }),
    });
    setAcceptanceDecision(null);
    await refreshTaskHistory(selectedTask.taskId);
  });

  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-3 overflow-hidden bg-muted/10 p-3 lg:grid-cols-[320px_minmax(0,1fr)]">
      <div className="flex min-h-0 flex-col gap-3">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">让 Agent 完成一项研发工作</CardTitle>
            <p className="text-xs text-muted-foreground">选择常用模板，或写清目标、约束和验收标准。</p>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {TASK_TEMPLATES.map((template) => (
                <button
                  key={template.label}
                  type="button"
                  onClick={() => {
                    setTitle(template.title);
                    setObjective(template.objective);
                  }}
                  className="rounded-full border border-border bg-background px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                >
                  {template.label}
                </button>
              ))}
            </div>
            <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="任务标题" />
            <textarea
              value={objective}
              onChange={(event) => setObjective(event.target.value)}
              className="min-h-24 w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              placeholder="说明任务目标、约束和验收标准"
            />
            <div className="flex items-center justify-between border-t border-border pt-3">
              <span className="text-xs font-semibold text-foreground">新任务执行配置</span>
              <span className="text-[10px] text-muted-foreground">仅用于新建任务</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select value={executor} onChange={(event) => setExecutor(event.target.value as Executor)} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                {EXECUTOR_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              {executor === 'claude' ? (
                <select value={connectionRef} onChange={(event) => setConnectionRef(event.target.value)} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                  <option value="">默认 Claude 线路</option>
                  {connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.name}{connection.defaultModel ? ` · ${connection.defaultModel}` : ''}</option>)}
                </select>
              ) : modelsLoading ? (
                <div className="flex items-center gap-2 rounded-md border border-input bg-muted/30 px-3 py-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />加载模型...</div>
              ) : modelOptions.length ? (
                <select value={model} onChange={(event) => setModel(event.target.value)} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                  <option value={defaultModel}>默认模型{defaultModel ? ` · ${defaultModel}` : ''}</option>
                  {modelOptions.filter((option) => option.value !== defaultModel).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              ) : (
                <Input value={model} onChange={(event) => setModel(event.target.value)} placeholder="模型（留空使用 Provider 默认值）" />
              )}
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
              <select value={approvalMode} onChange={(event) => setApprovalMode(event.target.value as ApprovalMode)} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                {approvalModeOptionsForPolicy(approvalPolicy?.mode).map((option) => (
                  <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>
                ))}
              </select>
              <Button variant="outline" size="sm" disabled={!registration} onClick={openApprovalPolicy} title="项目审批策略">
                <Settings2 className="h-4 w-4" />
                <span className="ml-1.5">项目策略</span>
              </Button>
            </div>
            {approvalPolicy?.mode === 'MANUAL' && (
              <p className="text-[11px] text-muted-foreground">
                当前项目采用手动确认。如需自动确认安全操作，请先打开“项目策略”调整项目上限。
              </p>
            )}
            <Button className="w-full" disabled={busy || !registration || !title.trim() || !objective.trim() || modelsLoading} onClick={createTask}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
              创建并执行
            </Button>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {executor === 'opencode'
                ? 'OpenCode 当前以只读模式运行，只允许读取文件和搜索代码，不会修改文件或执行命令。'
                : approvalMode === 'MANUAL'
                  ? `${executorLabel(executor)} 会在写文件和执行命令前等待你的确认。`
                  : `${executorLabel(executor)} 会按项目规则自动确认允许的安全操作，其余操作仍需你确认。`}
            </p>
          </CardContent>
        </Card>

        <Card className="flex min-h-0 flex-1 flex-col">
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm">任务列表</CardTitle>
            <Button variant="ghost" size="sm" disabled={!registration} onClick={() => registration && void loadTasks(registration.projectId)}>
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 p-0">
            <ScrollArea className="h-full px-3 pb-3">
              <div className="space-y-2">
                {tasks.map((task) => {
                  const presentation = statusPresentation(task.attemptStatus);
                  const resolution = resolutionPresentation(task.resolutionStatus);
                  const canDelete = !ACTIVE_STATUSES.has(task.attemptStatus);
                  return (
                    <div
                      key={task.taskId}
                      className={`flex w-full items-center rounded-lg border transition-colors ${selectedId === task.taskId ? 'border-primary bg-primary/5' : 'border-border bg-background hover:bg-accent/50'}`}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedId(task.taskId)}
                        className="min-w-0 flex-1 p-3 text-left"
                      >
                        <div className="flex items-start gap-2">
                          <presentation.Icon className={`mt-0.5 h-4 w-4 flex-shrink-0 ${presentation.tone} ${task.attemptStatus === 'STARTING' || task.attemptStatus === 'CANCELLING' ? 'animate-spin' : ''}`} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{task.title}</p>
                            <p className={`mt-1 text-xs ${presentation.tone}`}>{presentation.label} · 第 {task.attemptNumber ?? '-'} 次执行</p>
                            <span className={`mt-1 inline-flex rounded px-1.5 py-0.5 text-[10px] ${resolution.background} ${resolution.tone}`}>{resolution.label}</span>
                          </div>
                        </div>
                      </button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="mr-1 h-8 w-8 flex-shrink-0 p-0 text-muted-foreground hover:text-destructive"
                        disabled={busy || !canDelete}
                        onClick={() => requestTaskDeletion(task)}
                        aria-label={`删除任务：${task.title}`}
                        title={canDelete ? '删除任务' : '运行中的任务不能删除'}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  );
                })}
                {!tasks.length && <p className="py-8 text-center text-xs text-muted-foreground">暂无 Agent 任务</p>}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      <Card className="flex min-h-0 flex-col overflow-hidden">
        {error && (
          <div className="flex items-center gap-2 border-b border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />{error}
          </div>
        )}
        {!selectedTask ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            {registration ? '选择或创建一个任务' : '正在连接知枢控制面…'}
          </div>
        ) : (
          <>
            <CardHeader className="border-b border-border pb-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="mb-1 text-[11px] font-medium text-muted-foreground">任务标题</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle>{selectedTask.title}</CardTitle>
                    {(() => {
                      const attemptStatus = selectedAttempt?.status ?? selectedTask.attemptStatus;
                      const presentation = statusPresentation(attemptStatus);
                      return (
                        <span className={`inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-[11px] font-medium ${presentation.tone}`}>
                          <presentation.Icon className={`h-3 w-3 ${attemptStatus === 'STARTING' || attemptStatus === 'CANCELLING' ? 'animate-spin' : ''}`} />
                          本次执行：{presentation.label}
                        </span>
                      );
                    })()}
                    {(() => {
                      const resolution = resolutionPresentation(selectedTask.resolutionStatus);
                      return (
                        <span className={`inline-flex items-center rounded-full px-2 py-1 text-[11px] font-medium ${resolution.background} ${resolution.tone}`}>
                          任务：{resolution.label}
                        </span>
                      );
                    })()}
                  </div>
                  <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">原始任务目标：</span>{selectedTask.objective}
                  </p>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    当前查看：第 {selectedAttempt?.attemptNumber ?? selectedTask.attemptNumber ?? '-'} 次执行 · 创建于 {new Date(selectedAttempt?.createdAt ?? selectedTask.createdAt).toLocaleString()}
                  </p>
                  {selectedAttempt && (
                    <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                      <span className="rounded-md border border-border bg-muted/40 px-2 py-1">执行器：{executorLabel(selectedAttempt.executor)}</span>
                      <span
                        className="rounded-md border border-border bg-muted/40 px-2 py-1"
                        title={selectedAttempt.requestedApprovalMode && selectedAttempt.requestedApprovalMode !== selectedAttempt.approvalMode
                          ? `原选择为${approvalModeLabel(selectedAttempt.requestedApprovalMode)}，按项目规则采用更严格的${approvalModeLabel(selectedAttempt.approvalMode)}`
                          : undefined}
                      >
                        审批方式：{approvalModeLabel(selectedAttempt.approvalMode)}
                        {selectedAttempt.requestedApprovalMode && selectedAttempt.requestedApprovalMode !== selectedAttempt.approvalMode
                          ? '（项目规则已收紧）'
                          : ''}
                      </span>
                      <span className="rounded-md border border-border bg-muted/40 px-2 py-1">模型：{selectedAttempt.modelAlias || '默认模型'}</span>
                      {(selectedAttempt.executor ?? 'claude').toLowerCase() === 'claude' && (
                        <span className="rounded-md border border-border bg-muted/40 px-2 py-1">线路：{selectedAttempt.connectionRef ? (connections.find((connection) => connection.id === selectedAttempt.connectionRef)?.name || selectedAttempt.connectionRef) : '默认 Claude 线路'}</span>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  {selectedTask.resolutionStatus === 'NEEDS_FOLLOW_UP'
                    && !ACTIVE_STATUSES.has(selectedTask.attemptStatus) && (
                    <Button variant="outline" size="sm" disabled={busy} onClick={openFollowUp}>
                      <MessageSquarePlus className="mr-2 h-3.5 w-3.5" />添加跟进
                    </Button>
                  )}
                  {selectedTask.resolutionStatus === 'NEEDS_FOLLOW_UP'
                    && !ACTIVE_STATUSES.has(selectedTask.attemptStatus) && (
                    <Button variant="ghost" size="sm" disabled={busy} onClick={() => openAcceptance('CLOSED')}>
                      关闭任务
                    </Button>
                  )}
                  {ACTIVE_STATUSES.has(selectedTask.attemptStatus) && selectedTask.attemptStatus !== 'CANCELLING' && (
                    <Button variant="outline" size="sm" disabled={busy} onClick={() => controlTask('cancel')}>
                      <Square className="mr-2 h-3.5 w-3.5" />取消
                    </Button>
                  )}
                  {(['FAILED', 'ABORTED'].includes(selectedTask.attemptStatus)
                    || (selectedTask.attemptStatus === 'SUCCEEDED'
                      && artifacts.some((artifact) => artifact.attemptId === selectedTask.attemptId && isPermissionTimeout(artifact)))) && (
                    <Button variant="outline" size="sm" disabled={busy} onClick={() => controlTask('retry')}>
                      <RotateCcw className="mr-2 h-3.5 w-3.5" />重试
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>

            <ScrollArea className="min-h-0 flex-1">
              <div className="space-y-4 p-4">
                {selectedTask.resolutionStatus === 'WAITING_ACCEPTANCE'
                  && selectedTask.attemptStatus === 'SUCCEEDED'
                  && selectedAttempt?.attemptId === selectedTask.attemptId && (
                  <section className="rounded-md border border-amber-200 bg-amber-50/70 px-4 py-3 dark:border-amber-900/70 dark:bg-amber-950/25">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold text-amber-950 dark:text-amber-100">等待验收</h3>
                        <p className="mt-1 text-xs text-amber-800/80 dark:text-amber-200/70">
                          第 {selectedAttempt?.attemptNumber ?? selectedTask.attemptNumber ?? '-'} 次执行已经结束，请确认结果或提出下一轮修改要求。
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" disabled={busy} onClick={() => openAcceptance('RESOLVED')}>
                          <CheckCircle2 className="mr-2 h-3.5 w-3.5" />已解决
                        </Button>
                        <Button size="sm" variant="outline" disabled={busy} onClick={openFollowUp}>
                          <MessageSquarePlus className="mr-2 h-3.5 w-3.5" />需要跟进
                        </Button>
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => openAcceptance('CLOSED')}>关闭任务</Button>
                      </div>
                    </div>
                  </section>
                )}

                <section>
                  <div className="mb-3 flex items-end justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-semibold">执行历史</h3>
                      <p className="mt-0.5 text-xs text-muted-foreground">选择一次执行，查看当时的反馈、结果、事件和产物。</p>
                    </div>
                    <span className="text-[11px] text-muted-foreground">共 {attempts.length} 次</span>
                  </div>
                  <div className="-mx-1 overflow-x-auto px-1 pb-1" role="tablist" aria-label="执行历史">
                    <div className="flex min-w-max gap-1.5">
                      {attempts.map((attempt) => {
                        const presentation = statusPresentation(attempt.status);
                        const followUp = followUps.find((item) => item.attemptId === attempt.attemptId);
                        const decision = attempt.acceptanceDecision ?? followUp?.acceptanceDecision ?? null;
                        const accepted = acceptanceLabel(decision);
                        const hasFeedback = Boolean(attempt.followUpFeedback || followUp?.feedback);
                        const selected = selectedAttempt?.attemptId === attempt.attemptId;
                        const attemptState = accepted ?? (hasFeedback ? '包含跟进反馈' : presentation.label);
                        const secondaryTone = decision === 'RESOLVED'
                          ? 'text-emerald-600'
                          : decision === 'NEEDS_FOLLOW_UP'
                            ? 'text-amber-600'
                            : 'text-muted-foreground';
                        return (
                          <button
                            key={attempt.attemptId}
                            type="button"
                            role="tab"
                            aria-selected={selected}
                            onClick={() => setSelectedAttemptId(attempt.attemptId)}
                            className={`flex h-14 w-48 flex-none items-center gap-2 rounded-md border px-2.5 text-left transition-colors ${selected ? 'border-primary bg-primary/5 shadow-sm' : 'border-border bg-background hover:bg-accent/40'}`}
                            title={`第 ${attempt.attemptNumber} 次执行：${executorLabel(attempt.executor)}，${approvalModeLabel(attempt.approvalMode)}，${attemptState}`}
                          >
                            <span className={`flex h-7 w-7 flex-none items-center justify-center rounded-md text-xs font-semibold ${selected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                              {attempt.attemptNumber}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center justify-between gap-2">
                                <span className="truncate text-xs font-semibold">第 {attempt.attemptNumber} 次执行</span>
                                <presentation.Icon className={`h-3.5 w-3.5 flex-none ${presentation.tone} ${attempt.status === 'STARTING' || attempt.status === 'CANCELLING' ? 'animate-spin' : ''}`} />
                              </span>
                              <span className={`mt-0.5 block truncate text-[10px] ${accepted ? secondaryTone : presentation.tone}`}>
                                {executorLabel(attempt.executor)} · {approvalModeCompactLabel(attempt.approvalMode)} · {attemptState}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  {selectedAttempt && (() => {
                    const followUp = followUps.find((item) => item.attemptId === selectedAttempt.attemptId);
                    const feedback = selectedAttempt.followUpFeedback || followUp?.feedback;
                    const requestedAcceptance = selectedAttempt.requestedAcceptance || followUp?.requestedAcceptance;
                    const decision = selectedAttempt.acceptanceDecision ?? followUp?.acceptanceDecision ?? null;
                    const accepted = acceptanceLabel(decision);
                    if (!feedback && !requestedAcceptance && !selectedAttempt.errorMessage && !accepted) return null;
                    return (
                      <div className="mt-2 grid gap-x-5 gap-y-2 border-l-2 border-primary/40 bg-muted/30 px-3 py-2 text-xs sm:grid-cols-2">
                        <p className="font-semibold text-foreground sm:col-span-2">第 {selectedAttempt.attemptNumber} 次执行输入</p>
                        {feedback && <p className="min-w-0 break-words"><span className="font-medium text-foreground">本次反馈：</span><span className="text-muted-foreground">{feedback}</span></p>}
                        {requestedAcceptance && <p className="min-w-0 break-words"><span className="font-medium text-foreground">验收要求：</span><span className="text-muted-foreground">{requestedAcceptance}</span></p>}
                        {selectedAttempt.errorMessage && <p className="min-w-0 break-words text-red-600 sm:col-span-2"><span className="font-medium">执行错误：</span>{userFacingAttemptError(selectedAttempt.errorCode, selectedAttempt.errorMessage)}</p>}
                        {accepted && <p className={`font-medium ${decision === 'RESOLVED' ? 'text-emerald-600' : decision === 'NEEDS_FOLLOW_UP' ? 'text-amber-600' : 'text-muted-foreground'}`}>{accepted}</p>}
                      </div>
                    );
                  })()}
                </section>

                {currentStep && (() => {
                  const classes = toneClasses(currentStep.tone);
                  return (
                    <section className={`rounded-xl border ${classes.border} bg-background p-4 shadow-sm`}>
                      <div className="flex items-start gap-3">
                        <div className={`mt-0.5 rounded-full bg-muted p-2 ${classes.icon}`}>
                          {currentStep.tone === 'amber' ? <PauseCircle className="h-4 w-4" />
                            : currentStep.tone === 'green' ? <CheckCircle2 className="h-4 w-4" />
                              : currentStep.tone === 'red' ? <AlertCircle className="h-4 w-4" />
                                : <Loader2 className={`h-4 w-4 ${selectedAttempt && ACTIVE_STATUSES.has(selectedAttempt.status) ? 'animate-spin' : ''}`} />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">当前进度</p>
                          <h3 className="mt-1 text-base font-semibold">{currentStep.title}</h3>
                          <p className="mt-1 break-words text-sm text-muted-foreground">{currentStep.detail}</p>
                        </div>
                      </div>
                    </section>
                  );
                })()}

                {selectedApprovals.map((approval) => (
                  (() => {
                    const tool = toolPresentation(approval.toolName, approval.toolInput);
                    const diff = approvalDiff(approval.toolInput);
                    const command = readString(approval.toolInput, 'command');
                    const cwd = readString(approval.toolInput, 'cwd');
                    const fileChanges = approvalFileChanges(approval.toolInput);
                    const filePath = readString(approval.toolInput, 'file_path')
                      ?? readString(approval.toolInput, 'path')
                      ?? fileChanges[0]?.path
                      ?? null;
                    return (
                      <section key={approval.id} className="overflow-hidden rounded-md border border-amber-300 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/25">
                        <div className="p-4">
                          <div className="flex items-start gap-3">
                            <div className="rounded-lg bg-amber-100 p-2 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                              {approval.toolName === 'Bash' ? <TerminalSquare className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-[11px] font-medium uppercase tracking-wider text-amber-700 dark:text-amber-300">需要你的确认</p>
                              <h3 className="mt-1 font-semibold text-amber-950 dark:text-amber-100">Agent 想要{tool.action}</h3>
                              <p className="mt-2 text-xs text-amber-800/80 dark:text-amber-200/70">{tool.reason}允许后 Agent 会继续执行并验证结果。</p>
                            </div>
                          </div>

                          <dl className="mt-4 grid gap-px overflow-hidden rounded-md border border-amber-200 bg-amber-200 text-xs dark:border-amber-900/60 dark:bg-amber-900/60 sm:grid-cols-2">
                            {command && (
                              <div className="min-w-0 bg-background p-3 sm:col-span-2">
                                <dt className="text-[11px] text-muted-foreground">命令</dt>
                                <dd className="mt-1 overflow-auto whitespace-pre-wrap break-all font-mono text-foreground">{command}</dd>
                              </div>
                            )}
                            {cwd && (
                              <div className="min-w-0 bg-background p-3">
                                <dt className="text-[11px] text-muted-foreground">工作目录</dt>
                                <dd className="mt-1 break-all font-mono text-foreground">{cwd}</dd>
                              </div>
                            )}
                            {filePath && (
                              <div className="min-w-0 bg-background p-3">
                                <dt className="text-[11px] text-muted-foreground">文件路径</dt>
                                <dd className="mt-1 break-all font-mono text-foreground">{filePath}</dd>
                              </div>
                            )}
                            {fileChanges.length > 0 && (
                              <div className="min-w-0 bg-background p-3">
                                <dt className="text-[11px] text-muted-foreground">变更范围</dt>
                                <dd className="mt-1 text-foreground">{fileChanges.length} 个文件</dd>
                              </div>
                            )}
                            {fileChanges.length === 1 && fileChanges[0].kind && (
                              <div className="min-w-0 bg-background p-3">
                                <dt className="text-[11px] text-muted-foreground">变更类型</dt>
                                <dd className="mt-1 text-foreground">{changeKindLabel(fileChanges[0].kind)}</dd>
                              </div>
                            )}
                          </dl>

                          {fileChanges.map((change) => (
                            <div key={`${change.path}:${change.kind ?? ''}`} className="mt-3 overflow-hidden rounded-md border border-amber-200 bg-background dark:border-amber-900/60">
                              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2 text-xs">
                                <span className="break-all font-medium">{change.path}</span>
                                <span className="text-muted-foreground">{changeKindLabel(change.kind)}</span>
                              </div>
                              {change.diff ? (
                                <pre className="max-h-80 overflow-auto whitespace-pre p-3 font-mono text-[11px] leading-relaxed text-foreground">{change.diff}</pre>
                              ) : (
                                <p className="p-3 text-xs text-muted-foreground">Codex 未提供该文件的文本差异。</p>
                              )}
                            </div>
                          ))}

                          {(diff.oldString || diff.newString) && (
                            <div className="mt-3 overflow-hidden rounded-md border border-amber-200 bg-background dark:border-amber-900/60">
                              <div className="border-b border-border px-3 py-2 text-xs font-medium">
                                文件差异 {fileNameFromPath(tool.target) ? `· ${fileNameFromPath(tool.target)}` : ''}
                              </div>
                              <div className="grid max-h-72 overflow-auto text-xs lg:grid-cols-2">
                                <pre className="whitespace-pre-wrap break-words bg-red-50/60 p-3 leading-relaxed text-red-900 dark:bg-red-950/20 dark:text-red-200">{diff.oldString ? `- ${diff.oldString}` : '原文件中没有这段内容'}</pre>
                                <pre className="whitespace-pre-wrap break-words border-t border-border bg-emerald-50/60 p-3 leading-relaxed text-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-200 lg:border-l lg:border-t-0">{diff.newString ? `+ ${diff.newString}` : '将删除原内容'}</pre>
                              </div>
                            </div>
                          )}

                          <details className="mt-3 text-xs text-muted-foreground">
                            <summary className="cursor-pointer select-none">查看完整技术参数</summary>
                            <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-background/80 p-3">{JSON.stringify(approval.toolInput, null, 2)}</pre>
                          </details>
                          <div className="mt-4 flex flex-wrap gap-2">
                            <Button size="sm" disabled={busy || approval.status !== 'PENDING'} onClick={() => decide(approval, 'APPROVED')}>允许并继续</Button>
                            <Button size="sm" variant="outline" disabled={busy || approval.status !== 'PENDING'} onClick={() => decide(approval, 'DENIED')}>拒绝本次操作</Button>
                            <span className="self-center text-[11px] text-muted-foreground">风险等级：{approval.riskLevel || '未标记'}</span>
                          </div>
                        </div>
                      </section>
                    );
                  })()
                ))}

                <section>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-semibold">任务产物</h3>
                      <p className="mt-0.5 text-xs text-muted-foreground">这里是 Agent 最终交付的总结、代码变更、测试结果和异常说明。</p>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <button
                        type="button"
                        onClick={() => setArtifactFilter('ALL')}
                        className={`rounded-md px-2 py-1 text-xs ${artifactFilter === 'ALL' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}
                      >
                        全部 {attemptArtifacts.length}
                      </button>
                      {ARTIFACT_TYPES.map((item) => {
                        const count = attemptArtifacts.filter((artifact) => artifact.artifactType === item.value).length;
                        if (!count) return null;
                        return (
                          <button
                            key={item.value}
                            type="button"
                            onClick={() => setArtifactFilter(item.value)}
                            className={`rounded-md px-2 py-1 text-xs ${artifactFilter === item.value ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}
                          >
                            {item.label} {count}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="grid gap-3 xl:grid-cols-2">
                    {groupedArtifacts.map((group) => {
                      const artifact = group.representative;
                      const presentation = artifactPresentation(artifact.artifactType);
                      const artifactAttemptNumber = attempts.find((attempt) => attempt.attemptId === artifact.attemptId)?.attemptNumber;
                      const artifactProjectPath = artifact.artifactType === 'FILE_CHANGE'
                        ? projectRelativeArtifactPath(artifact, projectRef)
                        : null;
                      const command = typeof artifact.metadata.command === 'string'
                        ? artifact.metadata.command
                        : null;
                      const permissionTimeout = isPermissionTimeout(artifact);
                      return (
                        <article key={group.key} className={`min-w-0 rounded-xl border bg-background p-3 ${permissionTimeout ? 'border-amber-200 dark:border-amber-900/70' : 'border-border'}`}>
                          <div className="flex items-start justify-between gap-3">
                            <div className={`flex items-center gap-2 text-sm font-semibold ${permissionTimeout ? 'text-amber-600' : presentation.tone}`}>
                              {permissionTimeout ? <Clock3 className="h-4 w-4" /> : <presentation.Icon className="h-4 w-4" />}
                              {permissionTimeout ? '审批等待超时' : presentation.label}
                              {group.count > 1 && <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">重复 {group.count} 次</span>}
                            </div>
                            <div className="flex items-center gap-1.5">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0"
                                onClick={() => setPreviewArtifact(artifact)}
                                title={`预览${presentation.label}`}
                                aria-label={`预览${presentation.label}`}
                              >
                                <Maximize2 className="h-3.5 w-3.5" />
                              </Button>
                              {artifactProjectPath && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 w-7 p-0"
                                  onClick={() => openArtifactFile(artifactProjectPath)}
                                  title={`在右侧打开 ${fileNameFromPath(artifactProjectPath) ?? artifactProjectPath}`}
                                  aria-label={`在右侧打开 ${fileNameFromPath(artifactProjectPath) ?? artifactProjectPath}`}
                                >
                                  <PanelRightOpen className="h-3.5 w-3.5" />
                                </Button>
                              )}
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0"
                                disabled={!artifact.contentPlain}
                                onClick={() => void copyArtifact(artifact)}
                                title={artifact.contentPlain ? `复制${presentation.label}` : '该产物没有可复制的文本内容'}
                                aria-label={artifact.contentPlain ? `复制${presentation.label}` : '该产物没有可复制的文本内容'}
                              >
                                {copiedArtifactId === artifact.id
                                  ? <Check className="h-3.5 w-3.5 text-emerald-600" />
                                  : <Copy className="h-3.5 w-3.5" />}
                              </Button>
                              <span className="text-[10px] text-muted-foreground">
                                {artifactAttemptNumber ? `第 ${artifactAttemptNumber} 次执行` : `执行记录 ${artifact.attemptId.slice(0, 8)}`}
                              </span>
                            </div>
                          </div>
                          {command && (
                            <code className="mt-2 block truncate rounded bg-muted px-2 py-1 text-[11px] text-muted-foreground" title={command}>
                              $ {command}
                            </code>
                          )}
                          {permissionTimeout ? (
                            <div className="mt-3 rounded-lg bg-amber-50 p-3 text-xs leading-relaxed text-amber-900 dark:bg-amber-950/25 dark:text-amber-200">
                              Agent 等待你审批时超过了时限，本次 {typeof artifact.metadata.toolName === 'string' ? artifact.metadata.toolName : '工具'} 操作没有执行。它不是代码错误；如任务已结束，请重试任务并及时处理审批。
                            </div>
                          ) : ['SUMMARY', 'TEST_REPORT', 'ERROR_REPORT'].includes(artifact.artifactType) ? (
                            <div className="mt-3 max-h-72 overflow-auto rounded-md bg-muted/40 px-3 py-2.5">
                              <Markdown className="max-w-none break-words text-xs leading-relaxed text-foreground [&_h1]:mb-2 [&_h1]:mt-3 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:mb-1.5 [&_h2]:mt-3 [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:mb-1 [&_h3]:mt-2.5 [&_h3]:text-xs [&_h3]:font-semibold [&_h4]:mb-1 [&_h4]:mt-2 [&_h4]:text-xs [&_h4]:font-semibold [&_hr]:my-3 [&_hr]:border-border [&_strong]:font-semibold">
                                {artifact.contentPlain || '该产物没有内联文本内容'}
                              </Markdown>
                            </div>
                          ) : (
                            <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/60 p-3 text-xs leading-relaxed">
                              {artifact.contentPlain || '该产物没有内联文本内容'}
                            </pre>
                          )}
                          <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                            <span>{artifact.producer}</span>
                            <time dateTime={artifact.createdAt}>{new Date(artifact.createdAt).toLocaleString()}</time>
                          </div>
                        </article>
                      );
                    })}
                    {!groupedArtifacts.length && (
                      <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-xs text-muted-foreground xl:col-span-2">
                        任务运行后，任务总结、文件变更、Git Diff、测试报告和错误报告会出现在这里。
                      </div>
                    )}
                  </div>
                </section>

                <section>
                  <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-semibold">Agent 做了什么</h3>
                      <p className="mt-0.5 text-xs text-muted-foreground">按执行顺序展示关键步骤；连续重复事件已自动合并。</p>
                    </div>
                    <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={showTechnicalEvents}
                        onChange={(event) => setShowTechnicalEvents(event.target.checked)}
                        className="h-3.5 w-3.5 rounded border-input"
                      />
                      显示原始 JSON
                    </label>
                  </div>
                  <div className="space-y-3 border-l border-border pl-4">
                    {readableTimeline.map((item, index) => {
                      const classes = toneClasses(item.tone);
                      const lastEvent = item.events.at(-1) ?? item.events[0];
                      return (
                        <article key={`${item.key}-${item.events[0].id}`} className={`relative rounded-xl border ${classes.border} bg-background p-3.5`}>
                          <span className={`absolute -left-[21px] top-5 h-2.5 w-2.5 rounded-full ring-4 ring-background ${classes.dot}`} />
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex min-w-0 items-start gap-3">
                              <span className={`mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold ${classes.icon}`}>{index + 1}</span>
                              <div className="min-w-0">
                                <h4 className="text-sm font-medium">{item.title}</h4>
                                {item.detail && <p className="mt-1 break-all text-xs leading-relaxed text-muted-foreground">{item.detail}</p>}
                              </div>
                            </div>
                            <div className="flex flex-shrink-0 items-center gap-2 text-[10px] text-muted-foreground">
                              {item.events.length > 1 && <span className="rounded-full bg-muted px-1.5 py-0.5">重复 {item.events.length} 次</span>}
                              <time dateTime={item.occurredAt}>{new Date(item.occurredAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
                            </div>
                          </div>
                          {showTechnicalEvents && (
                            <details className="mt-3 border-t border-border pt-2 text-xs text-muted-foreground">
                              <summary className="flex cursor-pointer list-none items-center gap-1 font-medium">
                                <ChevronDown className="h-3 w-3" />技术详情 · {lastEvent.eventType} · #{lastEvent.sequenceNo}
                              </summary>
                              <pre className="mt-2 max-h-56 overflow-auto rounded-lg bg-muted/60 p-3">{JSON.stringify(lastEvent.payload, null, 2)}</pre>
                            </details>
                          )}
                        </article>
                      );
                    })}
                    {!readableTimeline.length && <p className="rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground">Agent 启动后，这里会用中文显示正在分析、调用工具、等待审批、执行测试和生成结果等步骤。</p>}
                  </div>
                </section>
              </div>
            </ScrollArea>
          </>
        )}
      </Card>

      <Dialog
        open={previewArtifact !== null}
        onOpenChange={(open) => { if (!open) setPreviewArtifact(null); }}
      >
        <DialogContent className="flex h-[82vh] max-h-[760px] max-w-4xl flex-col overflow-hidden rounded-lg p-0">
          {previewArtifact && (
            <>
              <DialogTitle>{artifactPresentation(previewArtifact.artifactType).label}预览</DialogTitle>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-2 text-xs text-muted-foreground">
                <span>
                  {(() => {
                    const attemptNumber = attempts.find((attempt) => attempt.attemptId === previewArtifact.attemptId)?.attemptNumber;
                    return attemptNumber ? `第 ${attemptNumber} 次执行` : `执行记录 ${previewArtifact.attemptId.slice(0, 8)}`;
                  })()}
                </span>
                <div className="flex items-center gap-2">
                  <time dateTime={previewArtifact.createdAt}>{new Date(previewArtifact.createdAt).toLocaleString()}</time>
                  {previewArtifactFilePath && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => openArtifactFile(previewArtifactFilePath)}
                      title={`在右侧打开 ${fileNameFromPath(previewArtifactFilePath) ?? previewArtifactFilePath}`}
                      aria-label={`在右侧打开 ${fileNameFromPath(previewArtifactFilePath) ?? previewArtifactFilePath}`}
                    >
                      <PanelRightOpen className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    disabled={!previewArtifact.contentPlain}
                    onClick={() => void copyArtifact(previewArtifact)}
                    title={previewArtifact.contentPlain ? `复制${artifactPresentation(previewArtifact.artifactType).label}` : '该产物没有可复制的文本内容'}
                    aria-label={previewArtifact.contentPlain ? `复制${artifactPresentation(previewArtifact.artifactType).label}` : '该产物没有可复制的文本内容'}
                  >
                    {copiedArtifactId === previewArtifact.id
                      ? <Check className="h-3.5 w-3.5 text-emerald-600" />
                      : <Copy className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
                {isPermissionTimeout(previewArtifact) ? (
                  <div className="mx-auto max-w-3xl rounded-md border border-amber-200 bg-amber-50 p-4 text-sm leading-7 text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/25 dark:text-amber-200">
                    Agent 等待你审批时超过了时限，本次 {typeof previewArtifact.metadata.toolName === 'string' ? previewArtifact.metadata.toolName : '工具'} 操作没有执行。它不是代码错误；如任务已结束，请重试任务并及时处理审批。
                  </div>
                ) : ['SUMMARY', 'TEST_REPORT', 'ERROR_REPORT'].includes(previewArtifact.artifactType) ? (
                  <Markdown className="mx-auto max-w-3xl break-words text-sm leading-7 text-foreground [&_h1]:mb-3 [&_h1]:mt-5 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:text-base [&_h3]:font-semibold [&_h4]:mb-1.5 [&_h4]:mt-3 [&_h4]:text-sm [&_h4]:font-semibold [&_hr]:my-5 [&_hr]:border-border [&_strong]:font-semibold">
                    {previewArtifact.contentPlain || '该产物没有内联文本内容'}
                  </Markdown>
                ) : (
                  <pre className="mx-auto max-w-none whitespace-pre-wrap break-words rounded-md bg-muted/60 p-4 font-mono text-sm leading-6 text-foreground">
                    {previewArtifact.contentPlain || '该产物没有内联文本内容'}
                  </pre>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={approvalPolicyOpen}
        onOpenChange={(open) => { if (!open) closeApprovalPolicy(); }}
      >
        <DialogContent className="max-w-xl rounded-lg p-0">
          <DialogTitle>项目审批策略</DialogTitle>
          <div className="space-y-4 p-5">
            <p className="text-sm text-muted-foreground">
              这里设置整个项目允许的最宽松审批方式。每次执行可以选择更严格的方式，但不能绕过项目上限。
            </p>
            <div>
              <label htmlFor="approval-policy-mode" className="text-sm font-medium">项目默认与最高模式</label>
              <select
                id="approval-policy-mode"
                value={approvalPolicy?.mode ?? 'MANUAL'}
                onChange={(event) => setApprovalPolicy((current) => current && ({ ...current, mode: event.target.value as ApprovalMode }))}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {APPROVAL_MODE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="approval-policy-directories" className="text-sm font-medium">允许的项目目录</label>
              <textarea id="approval-policy-directories" value={policyDirectories} onChange={(event) => setPolicyDirectories(event.target.value)} className="mt-1 min-h-20 w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-sm" placeholder="每行一个相对目录" />
            </div>
            <div>
              <label htmlFor="approval-policy-commands" className="text-sm font-medium">精确命令白名单</label>
              <textarea id="approval-policy-commands" value={policyCommands} onChange={(event) => setPolicyCommands(event.target.value)} className="mt-1 min-h-24 w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-sm" placeholder={'每行一个命令，例如：\nnpm run build\nmvn test'} />
            </div>
            <div>
              <label htmlFor="approval-policy-timeout" className="text-sm font-medium">审批超时（秒）</label>
              <Input id="approval-policy-timeout" type="number" min={5} max={300} value={policyTimeout} onChange={(event) => setPolicyTimeout(event.target.value)} />
            </div>
            <div className="flex justify-end gap-2 border-t border-border pt-4">
              <Button variant="outline" disabled={busy} onClick={closeApprovalPolicy}>取消</Button>
              <Button disabled={busy || Number(policyTimeout) < 5 || Number(policyTimeout) > 300 || !policyDirectories.trim()} onClick={saveApprovalPolicy}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                保存策略
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={followUpOpen}
        onOpenChange={(open) => {
          if (!busy) setFollowUpOpen(open);
        }}
      >
        <DialogContent className="max-w-xl rounded-lg p-0">
          <DialogTitle>添加任务跟进</DialogTitle>
          <div className="space-y-4 p-5">
            <div>
              <label htmlFor="task-follow-up-feedback" className="text-sm font-medium">本次反馈</label>
              <textarea
                id="task-follow-up-feedback"
                value={followUpFeedback}
                onChange={(event) => setFollowUpFeedback(event.target.value)}
                className="mt-1 min-h-24 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                placeholder="说明上一次结果哪里仍有问题"
              />
            </div>
            <div>
              <label htmlFor="task-follow-up-acceptance" className="text-sm font-medium">新的验收要求</label>
              <textarea
                id="task-follow-up-acceptance"
                value={followUpAcceptance}
                onChange={(event) => setFollowUpAcceptance(event.target.value)}
                className="mt-1 min-h-20 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                placeholder="说明这次必须满足的可验证条件"
              />
            </div>
            <div>
              <label htmlFor="task-follow-up-context" className="text-sm font-medium">补充上下文（可选）</label>
              <textarea
                id="task-follow-up-context"
                value={followUpContext}
                onChange={(event) => setFollowUpContext(event.target.value)}
                className="mt-1 min-h-16 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                placeholder="补充日志位置、复现条件或其他限制"
              />
            </div>
            <div className="space-y-3 border-t border-border pt-4">
              <div>
                <h3 className="text-sm font-semibold">下一次执行配置</h3>
                <p className="mt-1 text-xs text-muted-foreground">默认沿用当前执行；你可以在这里切换执行器、线路、模型和审批模式。</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="text-xs font-medium">
                  执行器
                  <select
                    value={followUpExecutor}
                    onChange={(event) => changeFollowUpExecutor(event.target.value as Executor)}
                    className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-normal"
                  >
                    {EXECUTOR_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                {followUpExecutor === 'claude' ? (
                  <label className="text-xs font-medium">
                    Claude 线路
                    <select
                      value={followUpConnectionRef}
                      onChange={(event) => setFollowUpConnectionRef(event.target.value)}
                      className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-normal"
                    >
                      <option value="">默认 Claude 线路</option>
                      {connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.name}{connection.defaultModel ? ` · ${connection.defaultModel}` : ''}</option>)}
                    </select>
                  </label>
                ) : followUpModelsLoading ? (
                  <div className="flex items-end">
                    <div className="flex w-full items-center gap-2 rounded-md border border-input bg-muted/30 px-3 py-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />加载模型...</div>
                  </div>
                ) : followUpModelOptions.length ? (
                  <label className="text-xs font-medium">
                    模型
                    <select
                      value={followUpModel}
                      onChange={(event) => setFollowUpModel(event.target.value)}
                      className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-normal"
                    >
                      <option value={followUpDefaultModel}>默认模型{followUpDefaultModel ? ` · ${followUpDefaultModel}` : ''}</option>
                      {followUpModelOptions.filter((option) => option.value !== followUpDefaultModel).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </label>
                ) : (
                  <label className="text-xs font-medium">
                    模型
                    <Input value={followUpModel} onChange={(event) => setFollowUpModel(event.target.value)} placeholder="留空使用 Provider 默认值" className="mt-1 font-normal" />
                  </label>
                )}
              </div>
              <label className="block text-xs font-medium">
                审批模式
                <select
                  value={followUpApprovalMode}
                  onChange={(event) => setFollowUpApprovalMode(event.target.value as ApprovalMode)}
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-normal"
                >
                  {APPROVAL_MODE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
                <span className="mt-1 block font-normal text-muted-foreground">
                  项目当前上限：{approvalModeLabel(approvalPolicy?.mode)}。选择自动模式后，可在下方调整项目策略。
                </span>
              </label>
              {approvalPolicy && effectiveApprovalMode(approvalPolicy.mode, followUpApprovalMode) !== followUpApprovalMode && (
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/25 dark:text-amber-100">
                  <span>当前项目会把本次执行收紧为“{approvalModeLabel(approvalPolicy.mode)}”。先调整项目策略，才能按所选模式执行。</span>
                  <Button type="button" variant="outline" size="sm" disabled={busy} onClick={openApprovalPolicyFromFollowUp}>
                    <Settings2 className="mr-1.5 h-3.5 w-3.5" />调整项目策略
                  </Button>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-border pt-4">
              <Button variant="outline" disabled={busy} onClick={() => setFollowUpOpen(false)}>取消</Button>
              <Button
                disabled={busy || followUpModelsLoading || !followUpFeedback.trim() || !followUpAcceptance.trim()
                  || Boolean(approvalPolicy && effectiveApprovalMode(approvalPolicy.mode, followUpApprovalMode) !== followUpApprovalMode)}
                onClick={submitFollowUp}
              >
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MessageSquarePlus className="mr-2 h-4 w-4" />}
                创建下一次执行
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={acceptanceDecision !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setAcceptanceDecision(null);
        }}
      >
        <DialogContent className="max-w-md rounded-lg p-0">
          <DialogTitle>记录任务验收</DialogTitle>
          <div className="space-y-4 p-5">
            <p className="text-sm text-muted-foreground">
              {acceptanceDecision === 'RESOLVED' ? '确认问题已经解决。' : '关闭任务后将保留全部执行和验收记录。'}
            </p>
            <div>
              <label htmlFor="task-acceptance-reason" className="text-sm font-medium">验收说明</label>
              <textarea
                id="task-acceptance-reason"
                value={acceptanceReason}
                onChange={(event) => setAcceptanceReason(event.target.value)}
                className="mt-1 min-h-20 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="flex justify-end gap-2 border-t border-border pt-4">
              <Button variant="outline" disabled={busy} onClick={() => setAcceptanceDecision(null)}>取消</Button>
              <Button disabled={busy || !acceptanceReason.trim()} onClick={submitAcceptance}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                确认
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteCandidate !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setDeleteCandidate(null);
        }}
      >
        <DialogContent className="max-w-md rounded-lg p-0">
          <DialogTitle>确认删除 Agent 任务</DialogTitle>
          <div className="p-5">
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-destructive/10 p-2 text-destructive">
                <Trash2 className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-semibold">删除任务</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  确定删除“<span className="break-words font-medium text-foreground">{deleteCandidate?.title}</span>”吗？
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  执行记录、审批、事件和产物会一并删除，且无法恢复。
                </p>
                {error && (
                  <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {error}
                  </p>
                )}
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" disabled={busy} onClick={() => setDeleteCandidate(null)}>
                取消
              </Button>
              <Button variant="destructive" disabled={busy} onClick={confirmDeleteTask}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                删除
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
