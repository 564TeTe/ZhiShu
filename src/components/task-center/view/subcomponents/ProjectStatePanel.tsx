import { AlertTriangle, CheckCircle2, Database, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input } from '../../../../shared/view/ui';
import { useProjectState } from '../../hooks/useProjectState';
import type { StateChangeCandidate, StateChangeProposal } from '../../model/taskCenterModel';
import { proposalStatusLabel } from '../taskCenterLabels';

const stateEntryTypeLabels: Record<string, string> = {
  GOAL: '目标',
  STAGE: '阶段',
  SUMMARY: '状态摘要',
  BLOCKER: '当前阻塞',
  DECISION: '关键决策',
  CONSTRAINT: '有效约束',
  DISCOVERY: '重要发现',
  RISK: '风险',
};

const candidateDispositionLabels: Record<string, string> = {
  NEW: '新增',
  STALE: '已过期',
  CONFLICT: '有冲突',
  MERGED: '已合并',
};

const authorityLevelLabels: Record<string, string> = {
  SYSTEM_VERIFIED: '系统已验证',
  USER_CONFIRMED: '用户已确认',
  AGENT_OBSERVED: '执行代理观测',
  AGENT_INFERRED: '执行代理推断',
};

type ProjectStatePanelProps = {
  projectId: string;
  refreshToken?: number;
};

export function ProjectStatePanel({ projectId, refreshToken = 0 }: ProjectStatePanelProps) {
  const {
    state,
    proposals,
    error,
    isLoading,
    isSaving,
    refresh,
    establishInitialState,
    confirmProposal,
    rejectProposal,
  } = useProjectState(projectId, refreshToken);
  const [goal, setGoal] = useState('');
  const [stage, setStage] = useState('');
  const [summary, setSummary] = useState('');
  const [blocker, setBlocker] = useState('');
  const [rejectionReasons, setRejectionReasons] = useState<Record<string, string>>({});
  const decisions = useMemo(
    () => state?.entries.filter((entry) => entry.entryType === 'DECISION') ?? [],
    [state],
  );
  const constraints = useMemo(
    () => state?.entries.filter((entry) => entry.entryType === 'CONSTRAINT') ?? [],
    [state],
  );
  const discoveriesAndRisks = useMemo(
    () => state?.entries.filter((entry) => ['DISCOVERY', 'RISK'].includes(entry.entryType)) ?? [],
    [state],
  );

  return (
    <Card className="rounded-none">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Database className="h-4 w-4 text-primary" aria-hidden="true" />项目状态与决策
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            数据库中的权威项目快照；普通运行日志不会直接改写状态版本。
          </p>
        </div>
        <div className="flex items-center gap-2">
          {state && <Badge variant="outline">状态版本 {state.stateRevision}</Badge>}
          <Button variant="ghost" size="icon" onClick={refresh} aria-label="刷新项目状态">
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
        {state?.stateRevision === 0 ? (
          <form
            className="grid gap-3 md:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              void establishInitialState({
                goal,
                stage,
                summary: summary.trim() || null,
                blocker: blocker.trim() || null,
                decisions: [],
                constraints: [],
                risks: [],
              });
            }}
          >
            <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground md:col-span-2">
              先创建提案，再以当前登录用户确认；确认后才写入权威状态。
            </div>
            <Input value={goal} onChange={(event) => setGoal(event.target.value)} placeholder="当前项目目标" required />
            <Input value={stage} onChange={(event) => setStage(event.target.value)} placeholder="当前阶段" required />
            <Input value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="状态摘要（可选）" />
            <Input value={blocker} onChange={(event) => setBlocker(event.target.value)} placeholder="当前阻塞（可选）" />
            <Button type="submit" disabled={isSaving} className="md:col-span-2 md:w-fit">
              <CheckCircle2 className="mr-2 h-4 w-4" />{isSaving ? '正在确认…' : '创建并确认初始状态'}
            </Button>
          </form>
        ) : state ? (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <StateSummary label="目标" value={state.goal?.content} />
              <StateSummary label="阶段" value={state.stage?.content} />
              <StateSummary label="状态摘要" value={state.summary} />
              <StateSummary label="当前阻塞" value={state.blocker} />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <EntryList title="关键决策" entries={decisions} />
              <EntryList title="有效约束" entries={constraints} />
              <EntryList title="发现与风险" entries={discoveriesAndRisks} />
            </div>
            <StateProposalHistory
              proposals={proposals}
              isSaving={isSaving}
              rejectionReasons={rejectionReasons}
              onReasonChange={(proposalId, value) => setRejectionReasons((current) => ({
                ...current,
                [proposalId]: value,
              }))}
              onConfirm={(proposalId) => void confirmProposal(proposalId).catch(() => undefined)}
              onReject={(proposalId, reason) => void rejectProposal(proposalId, reason).catch(() => undefined)}
            />
          </div>
        ) : !isLoading ? <p className="text-sm text-muted-foreground">暂无项目状态。</p> : null}
      </CardContent>
    </Card>
  );
}

function StateProposalHistory({
  proposals,
  isSaving,
  rejectionReasons,
  onReasonChange,
  onConfirm,
  onReject,
}: {
  proposals: StateChangeProposal[];
  isSaving: boolean;
  rejectionReasons: Record<string, string>;
  onReasonChange(proposalId: string, value: string): void;
  onConfirm(proposalId: string): void;
  onReject(proposalId: string, reason: string): void;
}) {
  return (
    <section className="border-t pt-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-medium">状态更新提案</div>
        <Badge variant="outline">{proposals.length} 条提案记录</Badge>
      </div>
      {proposals.length === 0 ? (
        <p className="text-xs text-muted-foreground">暂无待审阅的状态更新提案。</p>
      ) : (
        <div className="space-y-3">
          {proposals.map((proposal) => {
            const rejectionReason = rejectionReasons[proposal.proposalId] ?? '';
            return (
              <details
                key={proposal.proposalId}
                className="rounded-md border p-3"
                open={proposal.status === 'PENDING_APPROVAL'}
              >
                <summary className="cursor-pointer list-none">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                      执行报告 <span className="font-mono text-xs">{proposal.payload.reportId.slice(0, 8)}</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-2">
                      <Badge variant={proposal.status === 'PENDING_APPROVAL' ? 'default' : 'outline'}>
                        {proposalStatusLabel(proposal.status)}
                      </Badge>
                      <Badge variant="secondary">基于版本 {proposal.baseStateRevision}</Badge>
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {proposal.createdBy} · {new Date(proposal.createdAt).toLocaleString()} · {proposal.payload.roleVersion}
                  </p>
                </summary>
                <div className="mt-3 space-y-3">
                  <div className="flex flex-wrap gap-2 text-[11px]">
                    <Badge variant="outline">新增 {proposal.payload.summary.newCandidates}</Badge>
                    <Badge variant="outline">过期 {proposal.payload.summary.staleCandidates}</Badge>
                    <Badge variant="outline">冲突 {proposal.payload.summary.conflictCandidates}</Badge>
                    <Badge variant="outline">合并 {proposal.payload.summary.mergedCandidates}</Badge>
                  </div>
                  {proposal.payload.candidates.length === 0 ? (
                    <p className="text-xs text-muted-foreground">报告中没有可审阅的 State 候选。</p>
                  ) : proposal.payload.candidates.map((candidate) => (
                    <StateCandidate key={candidate.candidateKey} candidate={candidate} />
                  ))}
                  {proposal.status === 'PENDING_APPROVAL' ? (
                    <div className="flex flex-col gap-2 border-t pt-3 sm:flex-row">
                      <Button
                        size="sm"
                        disabled={isSaving}
                        onClick={() => onConfirm(proposal.proposalId)}
                      >
                      <CheckCircle2 className="mr-1 h-3.5 w-3.5" />确认新增内容
                      </Button>
                      <Input
                        value={rejectionReason}
                        onChange={(event) => onReasonChange(proposal.proposalId, event.target.value)}
                        placeholder="拒绝原因"
                        aria-label="State Change Proposal 拒绝原因"
                        className="sm:max-w-sm"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isSaving || !rejectionReason.trim()}
                        onClick={() => onReject(proposal.proposalId, rejectionReason.trim())}
                      >
                        <XCircle className="mr-1 h-3.5 w-3.5" />拒绝提案
                      </Button>
                    </div>
                  ) : (
                    <p className="border-t pt-3 text-[11px] text-muted-foreground">
                      {proposal.decidedBy ?? '—'} · {proposal.decidedAt
                        ? new Date(proposal.decidedAt).toLocaleString()
                        : '未记录决策时间'}
                      {proposal.appliedRevision !== null ? ` · 已写入状态版本 ${proposal.appliedRevision}` : ''}
                    </p>
                  )}
                </div>
              </details>
            );
          })}
        </div>
      )}
    </section>
  );
}

function StateCandidate({ candidate }: { candidate: StateChangeCandidate }) {
  const dispositionVariant = candidate.disposition === 'CONFLICT'
    ? 'destructive'
    : candidate.disposition === 'NEW' ? 'default' : 'secondary';
  return (
    <div className="rounded-md border bg-muted/20 p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{candidate.title}</span>
            <Badge variant="outline">{stateEntryTypeLabels[candidate.entryType] ?? candidate.entryType}</Badge>
          </div>
          <p className="mt-1 break-words text-muted-foreground">{candidate.content}</p>
        </div>
        <Badge variant={dispositionVariant}>
          {candidate.disposition === 'CONFLICT' && <AlertTriangle className="mr-1 h-3 w-3" />}
          {candidateDispositionLabels[candidate.disposition] ?? candidate.disposition}
        </Badge>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        {candidate.rationale || '无补充依据'} · {candidate.evidenceReferenceIds.length} 条证据
        {candidate.mergedCandidateCount > 1 ? ` · 合并 ${candidate.mergedCandidateCount} 条` : ''}
      </p>
    </div>
  );
}

function StateSummary({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-medium">{value || '未记录'}</div>
    </div>
  );
}

function EntryList({ title, entries }: { title: string; entries: NonNullable<ReturnType<typeof useProjectState>['state']>['entries'] }) {
  return (
    <div>
      <div className="mb-2 text-sm font-medium">{title}</div>
      {entries.length === 0 ? <p className="text-xs text-muted-foreground">暂无记录</p> : (
        <div className="space-y-2">
          {entries.map((entry) => (
            <div key={entry.entryId} className="rounded-md border p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{entry.title}</span>
                <Badge variant="outline" className="gap-1 text-[10px]">
                  <ShieldCheck className="h-3 w-3" />{authorityLevelLabels[entry.authorityLevel] ?? entry.authorityLevel}
                </Badge>
              </div>
              <p className="mt-1 text-muted-foreground">{entry.content}</p>
              <p className="mt-2 text-[11px] text-muted-foreground">
                {entry.createdBy} · 状态版本 {entry.createdRevision}
                {entry.rationale ? ` · ${entry.rationale}` : ''}
                {entry.evidenceReferenceIds.length > 0 ? ` · ${entry.evidenceReferenceIds.length} 条证据` : ''}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
