package com.zhishu.task;

import java.util.Map;
import java.util.UUID;

import com.zhishu.approval.ApprovalMode;
import com.zhishu.profile.ExecutorType;

public record TaskFollowUpCommand(
        UUID parentAttemptId,
        String clientRequestId,
        String actor,
        String feedback,
        String requestedAcceptance,
        String connectionRef,
        ExecutorType executor,
        String modelAlias,
        ApprovalMode approvalMode,
        Map<String, Object> additionalContext
) {
}
