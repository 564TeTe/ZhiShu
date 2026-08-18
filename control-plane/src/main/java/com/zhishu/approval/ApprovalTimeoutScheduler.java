package com.zhishu.approval;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;

@Component
@ConditionalOnProperty(name = "zhishu.approval.timeout-scheduling-enabled", havingValue = "true", matchIfMissing = true)
public class ApprovalTimeoutScheduler {
    private final ApprovalService approvals;

    public ApprovalTimeoutScheduler(ApprovalService approvals) {
        this.approvals = approvals;
    }

    @Scheduled(fixedDelayString = "${zhishu.approval.timeout-scan-delay:1000}")
    public void denyExpiredApprovals() {
        approvals.denyExpired();
    }
}
