package com.zhishu.approval;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record ProjectApprovalPolicyView(
        UUID projectId,
        String projectRoot,
        ApprovalMode mode,
        List<String> allowedDirectories,
        List<List<String>> trustedCommands,
        int approvalTimeoutSeconds,
        Instant updatedAt
) {
    public ApprovalPolicySnapshot resolve(ApprovalMode requestedMode) {
        ApprovalMode requested = requestedMode == null ? mode : requestedMode;
        ApprovalMode effective = ApprovalMode.stricter(mode, requested);
        return new ApprovalPolicySnapshot(
                effective, requested, projectRoot, allowedDirectories, trustedCommands, approvalTimeoutSeconds
        );
    }
}
