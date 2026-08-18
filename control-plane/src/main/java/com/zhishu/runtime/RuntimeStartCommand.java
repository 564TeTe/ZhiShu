package com.zhishu.runtime;

import java.util.List;
import java.util.Map;
import com.zhishu.approval.ApprovalMode;

public record RuntimeStartCommand(
        String protocolVersion,
        String requestId,
        String idempotencyKey,
        String taskId,
        String attemptId,
        String projectRef,
        String executor,
        String modelAlias,
        String connectionRef,
        String objective,
        List<String> capabilities,
        PermissionPolicy permissionPolicy,
        Map<String, Object> context
) {
    public record PermissionPolicy(
            List<String> requireApprovalFor,
            ApprovalMode mode,
            String projectRoot,
            List<String> allowedDirectories,
            List<List<String>> trustedCommands,
            int approvalTimeoutSeconds
    ) {
        public PermissionPolicy(List<String> requireApprovalFor) {
            this(requireApprovalFor, ApprovalMode.MANUAL, ".", List.of("."), List.of(), 45);
        }
    }
}
