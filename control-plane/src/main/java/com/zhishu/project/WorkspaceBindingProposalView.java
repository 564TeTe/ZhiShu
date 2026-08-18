package com.zhishu.project;

import java.util.List;
import java.util.UUID;

public record WorkspaceBindingProposalView(
        UUID proposalId,
        String action,
        String machineId,
        String localProjectId,
        String workspacePath,
        UUID targetProjectId,
        List<UUID> candidateProjectIds,
        List<String> reasons,
        Long baseIdentityVersion,
        String status
) {
}
