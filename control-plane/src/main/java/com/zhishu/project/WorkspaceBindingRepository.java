package com.zhishu.project;

import java.util.List;
import java.util.Optional;

public interface WorkspaceBindingRepository {

    Optional<WorkspaceProjectMatch> findByMachineAndLocalProjectId(String machineId, String localProjectId);

    Optional<WorkspaceProjectMatch> findByMachineAndPath(String machineId, String normalizedWorkspacePath);

    List<WorkspaceProjectMatch> findByRemoteFingerprint(String remoteFingerprint);

    List<WorkspaceProjectMatch> findCompatibilityPath(String normalizedWorkspacePath);
}
