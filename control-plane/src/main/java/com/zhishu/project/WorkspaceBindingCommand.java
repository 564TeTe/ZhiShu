package com.zhishu.project;

import java.util.UUID;

public record WorkspaceBindingCommand(
        UUID proposalId,
        String action,
        UUID projectId,
        UUID workspaceId,
        String machineId,
        String localProjectId,
        String workspacePath,
        String normalizedWorkspacePath,
        long baseIdentityVersion,
        String actor,
        String clientRequestId,
        String requestHash
) {
}
