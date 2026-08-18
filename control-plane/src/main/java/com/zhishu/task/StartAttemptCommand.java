package com.zhishu.task;

import java.util.Map;
import java.util.UUID;

import com.zhishu.profile.AgentProfileSnapshot;
import com.zhishu.approval.ApprovalPolicySnapshot;

public record StartAttemptCommand(
        UUID taskId,
        String projectRef,
        String objective,
        AgentProfileSnapshot profileSnapshot,
        ApprovalPolicySnapshot approvalPolicySnapshot,
        Map<String, Object> additionalContext
) {
    public StartAttemptCommand(
            UUID taskId, String projectRef, String objective,
            AgentProfileSnapshot profileSnapshot, Map<String, Object> additionalContext
    ) {
        this(taskId, projectRef, objective, profileSnapshot,
                ApprovalPolicySnapshot.manual(projectRef), additionalContext);
    }
}
