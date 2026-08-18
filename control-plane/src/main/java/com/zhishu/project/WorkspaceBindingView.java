package com.zhishu.project;

import java.time.Instant;
import java.util.UUID;

public record WorkspaceBindingView(
        UUID workspaceId,
        UUID projectId,
        String machineId,
        String localProjectId,
        String workspacePath,
        String normalizedWorkspacePath,
        String repositoryUrl,
        String remoteFingerprint,
        String branch,
        boolean isPrimary,
        String status,
        Instant lastSeenAt
) {
}
