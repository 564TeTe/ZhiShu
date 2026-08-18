package com.zhishu.approval;

import java.util.List;
import java.util.Objects;

public record ApprovalPolicySnapshot(
        ApprovalMode mode,
        ApprovalMode requestedMode,
        String projectRoot,
        List<String> allowedDirectories,
        List<List<String>> trustedCommands,
        int approvalTimeoutSeconds
) {
    public ApprovalPolicySnapshot {
        Objects.requireNonNull(mode, "mode");
        requestedMode = requestedMode == null ? mode : requestedMode;
        Objects.requireNonNull(projectRoot, "projectRoot");
        allowedDirectories = List.copyOf(Objects.requireNonNull(allowedDirectories, "allowedDirectories"));
        trustedCommands = Objects.requireNonNull(trustedCommands, "trustedCommands").stream()
                .map(List::copyOf)
                .toList();
        if (approvalTimeoutSeconds < 5 || approvalTimeoutSeconds > 300) {
            throw new IllegalArgumentException("approvalTimeoutSeconds must be between 5 and 300");
        }
    }

    public ApprovalPolicySnapshot(
            ApprovalMode mode,
            String projectRoot,
            List<String> allowedDirectories,
            List<List<String>> trustedCommands,
            int approvalTimeoutSeconds
    ) {
        this(mode, mode, projectRoot, allowedDirectories, trustedCommands, approvalTimeoutSeconds);
    }

    public static ApprovalPolicySnapshot manual(String projectRoot) {
        return new ApprovalPolicySnapshot(ApprovalMode.MANUAL, projectRoot, List.of("."), List.of(), 45);
    }
}
