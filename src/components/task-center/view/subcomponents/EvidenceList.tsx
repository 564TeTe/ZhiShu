import { Check, CircleDashed, FileText, GitPullRequestArrow, Loader2, ShieldAlert, X } from 'lucide-react';

import { Badge, Button } from '../../../../shared/view/ui';
import type {
  TaskCenterDetailApproval,
  TaskCenterDetailArtifact,
  TaskCenterDetailFollowUp,
} from '../../model/taskCenterModel';

type EvidenceListProps = {
  approvals: TaskCenterDetailApproval[];
  artifacts: TaskCenterDetailArtifact[];
  followUps: TaskCenterDetailFollowUp[];
  activeCommand: string | null;
  onApprovalDecision(approvalId: string, decision: 'APPROVED' | 'DENIED'): Promise<void>;
  readOnly?: boolean;
};

export function EvidenceList({
  approvals,
  artifacts,
  followUps,
  activeCommand,
  onApprovalDecision,
  readOnly = false,
}: EvidenceListProps) {
  if (approvals.length === 0 && artifacts.length === 0 && followUps.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground">
        <CircleDashed className="mx-auto mb-2 h-5 w-5" aria-hidden="true" />
        当前服务端没有待审批、产物或跟进记录。
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {approvals.length > 0 && (
        <section className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">待审批操作</div>
          {approvals.map((approval) => (
            <div key={approval.approvalId} className="rounded-lg border border-amber-500/30 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
                  <ShieldAlert className="h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
                  <span className="truncate">{approval.toolName}</span>
                </div>
                <Badge variant="outline">{approval.riskLevel ?? approval.status}</Badge>
              </div>
              <div className="mt-2 text-xs text-muted-foreground">执行记录：{approval.attemptId}</div>
              {Object.keys(approval.toolInput).length > 0 && (
                <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-muted/50 p-2 text-[11px]">
                  {JSON.stringify(approval.toolInput, null, 2)}
                </pre>
              )}
              {approval.status === 'PENDING' && (
                <div className="mt-3 flex justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={readOnly || activeCommand !== null}
                    onClick={() => void onApprovalDecision(approval.approvalId, 'DENIED').catch(() => undefined)}
                  >
                    {activeCommand === `approval:${approval.approvalId}`
                      ? <Loader2 className="animate-spin" aria-hidden="true" />
                      : <X aria-hidden="true" />}
                    拒绝
                  </Button>
                  <Button
                    size="sm"
                    disabled={readOnly || activeCommand !== null}
                    onClick={() => void onApprovalDecision(approval.approvalId, 'APPROVED').catch(() => undefined)}
                  >
                    {activeCommand === `approval:${approval.approvalId}`
                      ? <Loader2 className="animate-spin" aria-hidden="true" />
                      : <Check aria-hidden="true" />}
                    批准
                  </Button>
                </div>
              )}
            </div>
          ))}
        </section>
      )}

      {artifacts.length > 0 && (
        <section className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">执行产物</div>
          {artifacts.map((artifact) => (
            <div key={artifact.artifactId} className="rounded-lg border p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
                  <FileText className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  <span>{artifact.artifactType}</span>
                </div>
                <Badge variant="secondary">{artifact.producer}</Badge>
              </div>
              <div className="mt-2 text-xs text-muted-foreground">执行记录：{artifact.attemptId}</div>
              {artifact.contentPlain && (
                <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap rounded bg-muted/50 p-2 text-xs leading-5">
                  {artifact.contentPlain}
                </pre>
              )}
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                {artifact.mimeType && <span>{artifact.mimeType}</span>}
                {artifact.sizeBytes !== null && <span>{artifact.sizeBytes} bytes</span>}
                {artifact.hash && <span className="font-mono">hash {artifact.hash}</span>}
              </div>
            </div>
          ))}
        </section>
      )}

      {followUps.length > 0 && (
        <section className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">跟进历史</div>
          {followUps.map((followUp) => (
            <div key={followUp.followUpId} className="rounded-lg border p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <GitPullRequestArrow className="h-4 w-4 text-primary" aria-hidden="true" />
                  第 {followUp.attemptNumber} 次执行
                </div>
                <Badge variant="outline">{followUp.attemptStatus}</Badge>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">{followUp.feedback}</p>
              <div className="mt-2 rounded bg-muted/40 p-2 text-xs">
                验收要求：{followUp.requestedAcceptance}
              </div>
              {followUp.acceptanceDecision && (
                <div className="mt-2 text-xs text-emerald-700 dark:text-emerald-300">
                  人工验收：{followUp.acceptanceDecision}
                  {followUp.acceptanceReason ? ` · ${followUp.acceptanceReason}` : ''}
                </div>
              )}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
