package com.zhishu.approval;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

import com.zhishu.task.AttemptStatus;

public record ApprovalView(
        UUID id,
        UUID taskId,
        UUID attemptId,
        String runtimeRunId,
        String runtimeApprovalId,
        String toolName,
        Map<String, Object> toolInput,
        String riskLevel,
        String status,
        AttemptStatus attemptStatus,
        Instant expiresAt,
        Instant decidedAt,
        Instant createdAt,
        ApprovalPolicySnapshot approvalPolicySnapshot,
        String decisionSource,
        String policy,
        String rule,
        String reason
) {
    public ApprovalView(
            UUID id, UUID taskId, UUID attemptId, String runtimeRunId, String runtimeApprovalId,
            String toolName, Map<String, Object> toolInput, String riskLevel, String status,
            AttemptStatus attemptStatus, Instant expiresAt, Instant decidedAt, Instant createdAt
    ) {
        this(id, taskId, attemptId, runtimeRunId, runtimeApprovalId, toolName, toolInput, riskLevel,
                status, attemptStatus, expiresAt, decidedAt, createdAt,
                ApprovalPolicySnapshot.manual("."), null, null, null, null);
    }
}
