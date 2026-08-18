package com.zhishu.task;

import java.util.Map;
import java.util.UUID;

import com.zhishu.profile.ExecutorType;
import com.zhishu.approval.ApprovalMode;

public record CreateTaskCommand(
        UUID projectId,
        UUID profileId,
        String title,
        String objective,
        String connectionRef,
        ExecutorType executor,
        String modelAlias,
        ApprovalMode approvalMode,
        Map<String, Object> additionalContext
) {
    public CreateTaskCommand(
            UUID projectId, UUID profileId, String title, String objective, String connectionRef,
            ExecutorType executor, String modelAlias, Map<String, Object> additionalContext
    ) {
        this(projectId, profileId, title, objective, connectionRef, executor, modelAlias, null, additionalContext);
    }
    public CreateTaskCommand(
            UUID projectId,
            UUID profileId,
            String title,
            String objective,
            String connectionRef,
            ExecutorType executor,
            Map<String, Object> additionalContext
    ) {
        this(projectId, profileId, title, objective, connectionRef, executor, null, null, additionalContext);
    }

    public CreateTaskCommand(
            UUID projectId,
            UUID profileId,
            String title,
            String objective,
            String connectionRef,
            Map<String, Object> additionalContext
    ) {
        this(projectId, profileId, title, objective, connectionRef, null, null, null, additionalContext);
    }

    public CreateTaskCommand(
            UUID projectId,
            UUID profileId,
            String title,
            String objective,
            Map<String, Object> additionalContext
    ) {
        this(projectId, profileId, title, objective, null, null, null, null, additionalContext);
    }
}
