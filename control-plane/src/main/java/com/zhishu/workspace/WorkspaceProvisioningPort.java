package com.zhishu.workspace;

import java.nio.file.Path;
import java.util.UUID;

/**
 * Boundary for physical workspace operations. The default implementation only
 * creates a marked directory; a Git-backed Worktree adapter is a later, explicit
 * capability and must not be silently substituted here.
 */
public interface WorkspaceProvisioningPort {

    String physicalWorkspaceKind();

    ProvisionedWorkspace provision(ProvisionRequest request) throws Exception;

    void cleanup(CleanupRequest request) throws Exception;

    record ProvisionRequest(
            UUID leaseId,
            UUID scheduleId,
            UUID assignmentId,
            Path workspacePath,
            String ownershipToken,
            Path repositoryRoot,
            String baseCommit,
            String branchRef
    ) {
        public ProvisionRequest(
                UUID leaseId,
                UUID scheduleId,
                UUID assignmentId,
                Path workspacePath,
                String ownershipToken
        ) {
            this(leaseId, scheduleId, assignmentId, workspacePath, ownershipToken, null, null, null);
        }
    }

    record ProvisionedWorkspace(Path workspacePath) {
    }

    record CleanupRequest(
            Path workspacePath,
            String ownershipToken,
            Path repositoryRoot,
            String branchRef
    ) {
        public CleanupRequest(Path workspacePath, String ownershipToken) {
            this(workspacePath, ownershipToken, null, null);
        }
    }
}
