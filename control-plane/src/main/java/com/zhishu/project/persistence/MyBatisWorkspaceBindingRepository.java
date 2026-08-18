package com.zhishu.project.persistence;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.stereotype.Repository;

import com.zhishu.project.ProjectIdentityView;
import com.zhishu.project.ProjectRegistration;
import com.zhishu.project.WorkspaceBindingRepository;
import com.zhishu.project.WorkspaceBindingView;
import com.zhishu.project.WorkspaceProjectMatch;

@Repository
public class MyBatisWorkspaceBindingRepository implements WorkspaceBindingRepository {

    private final WorkspaceBindingMapper mapper;

    public MyBatisWorkspaceBindingRepository(WorkspaceBindingMapper mapper) {
        this.mapper = mapper;
    }

    @Override
    public Optional<WorkspaceProjectMatch> findByMachineAndLocalProjectId(
            String machineId,
            String localProjectId
    ) {
        return Optional.ofNullable(mapper.findByMachineAndLocalProjectId(machineId, localProjectId))
                .map(this::toMatch);
    }

    @Override
    public Optional<WorkspaceProjectMatch> findByMachineAndPath(String machineId, String normalizedWorkspacePath) {
        return Optional.ofNullable(mapper.findByMachineAndPath(machineId, normalizedWorkspacePath))
                .map(this::toMatch);
    }

    @Override
    public List<WorkspaceProjectMatch> findByRemoteFingerprint(String remoteFingerprint) {
        return mapper.findByRemoteFingerprint(remoteFingerprint).stream().map(this::toMatch).toList();
    }

    @Override
    public List<WorkspaceProjectMatch> findCompatibilityPath(String normalizedWorkspacePath) {
        return mapper.findCompatibilityPath(normalizedWorkspacePath).stream().map(this::toMatch).toList();
    }

    private WorkspaceProjectMatch toMatch(WorkspaceProjectMatchRow row) {
        UUID projectId = UUID.fromString(row.getProjectId());
        return new WorkspaceProjectMatch(
                new ProjectIdentityView(
                        projectId,
                        row.getDisplayName(),
                        row.getRepositoryIdentity(),
                        row.getProjectStatus(),
                        row.getIdentityVersion()
                ),
                new WorkspaceBindingView(
                        UUID.fromString(row.getWorkspaceId()),
                        projectId,
                        row.getMachineId(),
                        row.getLocalProjectId(),
                        row.getWorkspacePath(),
                        row.getNormalizedWorkspacePath(),
                        row.getRepositoryUrl(),
                        row.getRemoteFingerprint(),
                        row.getBranch(),
                        row.isPrimary(),
                        row.getBindingStatus(),
                        row.getLastSeenAt()
                ),
                new ProjectRegistration(
                        projectId,
                        UUID.fromString(row.getProfileId()),
                        row.getProjectRef(),
                        row.getProfileName()
                )
        );
    }
}
