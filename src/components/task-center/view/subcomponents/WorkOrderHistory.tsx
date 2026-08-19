import { Bot, CheckCircle2, FileCheck2, ListPlus, ShieldCheck, XCircle } from 'lucide-react';
import { useState } from 'react';

import { Badge, Button, Input } from '../../../../shared/view/ui';
import type { ExecutionReportView, WorkOrderView } from '../../model/taskCenterModel';
import { executionStatusLabel, planNodeStateLabel } from '../taskCenterLabels';

type WorkOrderHistoryProps = {
  workOrders: WorkOrderView[];
  isWorking: boolean;
  onVerify: (
    workOrderId: string,
    reportId: string,
    decision: 'PASSED' | 'FAILED',
    reason: string,
  ) => Promise<void>;
  onExtractStateCandidates: (reportId: string) => Promise<void>;
};

function EvidenceItems({ items, empty }: { items: ExecutionReportView['agentClaims']; empty: string }) {
  if (items.length === 0) return <p className="text-xs text-muted-foreground">{empty}</p>;
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div key={item.artifactId} className="rounded border bg-background/60 p-2 text-xs">
          <div className="flex flex-wrap items-center gap-1">
            <Badge variant="outline" className="text-[10px]">{item.artifactType}</Badge>
            <span className="font-mono text-[10px] text-muted-foreground">{item.hash?.slice(0, 12) ?? '无摘要'}</span>
          </div>
          <p className="mt-1 max-h-56 overflow-y-auto whitespace-pre-wrap break-words leading-5">{item.content ?? '无文本内容'}</p>
        </div>
      ))}
    </div>
  );
}

function VerificationGate({
  workOrder,
  report,
  isWorking,
  onVerify,
  onExtractStateCandidates,
}: {
  workOrder: WorkOrderView;
  report: ExecutionReportView;
  isWorking: boolean;
  onVerify: WorkOrderHistoryProps['onVerify'];
  onExtractStateCandidates: WorkOrderHistoryProps['onExtractStateCandidates'];
}) {
  const [reason, setReason] = useState('');
  if (report.verificationId) {
    return (
      <div className="space-y-2 text-xs">
        <Badge variant={report.decision === 'PASSED' ? 'default' : 'destructive'}>
          {report.decision === 'PASSED' ? <CheckCircle2 className="mr-1 h-3 w-3" /> : <XCircle className="mr-1 h-3 w-3" />}
          {report.decision === 'PASSED' ? '验证通过' : '验证未通过'}
        </Badge>
        <p>{report.reason}</p>
        <p className="text-muted-foreground">
          {report.verifiedBy} · {report.verifiedAt ? new Date(report.verifiedAt).toLocaleString() : '—'}
        </p>
        {report.stateEntryId && <p className="font-mono text-[10px]">项目资料记录 {report.stateEntryId}</p>}
        {report.brainThreadId && <p className="font-mono text-[10px]">关联对话 {report.brainThreadId}</p>}
        {report.brainSummary && (
          <div className="rounded border border-primary/20 bg-primary/5 p-2">
            <p className="mb-1 font-medium">项目大脑的下一步摘要</p>
            <p className="whitespace-pre-wrap">{report.brainSummary}</p>
            {report.brainContextPackageId && (
              <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                执行资料 {report.brainContextPackageId}
              </p>
            )}
          </div>
        )}
        {report.decision === 'PASSED' && (
          <Button
            size="sm"
            variant="outline"
            disabled={isWorking}
            onClick={() => void onExtractStateCandidates(report.reportId)}
          >
            <ListPlus className="mr-1 h-3.5 w-3.5" />提取状态候选内容
          </Button>
        )}
      </div>
    );
  }
  if (report.attemptStatus !== 'SUCCEEDED' || workOrder.status !== 'AWAITING_VERIFICATION') {
    return <p className="text-xs text-muted-foreground">当前报告不满足人工验证入口条件。</p>;
  }
  const hasSystemEvidence = report.systemEvidence.length > 0;
  return (
    <div className="space-y-2">
      <Input
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder="填写验证依据或拒绝原因"
        aria-label="验证原因"
      />
      {!hasSystemEvidence && (
        <p className="text-xs text-destructive">缺少系统观测证据，执行代理的声明不能直接通过人工验证。</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={isWorking || !reason.trim() || !hasSystemEvidence}
          onClick={() => void onVerify(workOrder.workOrderId, report.reportId, 'PASSED', reason.trim())}
        >
          <ShieldCheck className="mr-1 h-3.5 w-3.5" />验证通过
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={isWorking || !reason.trim()}
          onClick={() => void onVerify(workOrder.workOrderId, report.reportId, 'FAILED', reason.trim())}
        >
          <XCircle className="mr-1 h-3.5 w-3.5" />验证不通过
        </Button>
      </div>
    </div>
  );
}

export function WorkOrderHistory({
  workOrders,
  isWorking,
  onVerify,
  onExtractStateCandidates,
}: WorkOrderHistoryProps) {
  if (workOrders.length === 0) {
    return <p className="mt-2 text-xs text-muted-foreground">尚无执行记录。</p>;
  }
  return (
    <div className="mt-3 space-y-2">
      {workOrders.map((workOrder) => (
        <details key={workOrder.workOrderId} className="rounded-md border bg-background/50 p-3" open={workOrders.length === 1}>
          <summary className="cursor-pointer list-none">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-xs font-medium">
                执行记录 <span className="font-mono">{workOrder.workOrderId.slice(0, 8)}</span>
                <Badge variant="secondary">{planNodeStateLabel(workOrder.status)}</Badge>
              </span>
              <span className="text-[10px] text-muted-foreground">
                任务 {workOrder.taskId.slice(0, 8)} · 方案版本 {workOrder.versionNumber}
              </span>
            </div>
          </summary>
          <div className="mt-3 space-y-3">
            <p className="text-xs text-muted-foreground">
              一次执行成功后只会生成执行报告并进入待验证，不会自动把计划节点标为完成。
            </p>
            {workOrder.statusReason && <p className="text-xs text-destructive">{workOrder.statusReason}</p>}
            {workOrder.reports.length === 0 ? (
              <p className="text-xs text-muted-foreground">执行报告尚未生成，可在任务详情中查看本次执行进度。</p>
            ) : workOrder.reports.map((report) => (
              <div key={report.reportId} className="rounded-md border p-3">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-medium">执行报告 · 第 {report.attemptId.slice(0, 8)} 次记录</span>
                  <Badge variant="outline">{executionStatusLabel(report.attemptStatus)}</Badge>
                </div>
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1.45fr)_minmax(260px,0.85fr)]">
                  <section className="min-w-0 rounded-md bg-muted/30 p-3">
                    <h4 className="mb-2 flex items-center gap-1 text-xs font-semibold">
                      <Bot className="h-3.5 w-3.5" />执行代理声明
                    </h4>
                    <EvidenceItems items={report.agentClaims} empty="执行代理未提交声明。" />
                  </section>
                  <div className="grid min-w-0 gap-3">
                    <section className="min-w-0 rounded-md bg-muted/30 p-3">
                      <h4 className="mb-2 flex items-center gap-1 text-xs font-semibold">
                        <FileCheck2 className="h-3.5 w-3.5" />系统观测证据
                      </h4>
                      <EvidenceItems items={report.systemEvidence} empty="无系统观测证据。" />
                    </section>
                    <section className="min-w-0 rounded-md bg-muted/30 p-3">
                      <h4 className="mb-2 flex items-center gap-1 text-xs font-semibold">
                        <ShieldCheck className="h-3.5 w-3.5" />人工验证
                      </h4>
                      <VerificationGate
                        workOrder={workOrder}
                        report={report}
                        isWorking={isWorking}
                        onVerify={onVerify}
                        onExtractStateCandidates={onExtractStateCandidates}
                      />
                    </section>
                  </div>
                </div>
              </div>
            ))}
            <p className="text-[10px] text-muted-foreground">
              追踪记录：{workOrder.events.length} 个执行事件 · 执行资料版本 {String(workOrder.contextVersion.workOrderContextVersion ?? '1.0')}
            </p>
          </div>
        </details>
      ))}
    </div>
  );
}
