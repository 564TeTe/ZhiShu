package com.zhishu.project.persistence;

import java.util.Optional;
import java.util.UUID;

import org.springframework.stereotype.Repository;

import com.zhishu.project.ProjectCatalogRepository;
import com.zhishu.project.ProjectRegistration;

@Repository
public class MyBatisProjectCatalogRepository implements ProjectCatalogRepository {

    private final ProjectCatalogMapper mapper;

    public MyBatisProjectCatalogRepository(ProjectCatalogMapper mapper) {
        this.mapper = mapper;
    }

    @Override
    public UUID ensureProject(UUID candidateId, String projectRef, String displayName) {
        UUID projectId = UUID.fromString(mapper.ensureProject(candidateId, projectRef, displayName));
        mapper.ensureApprovalPolicy(projectId);
        mapper.ensureCompatibilityWorkspaceBinding(projectId, projectRef);
        return projectId;
    }

    @Override
    public Optional<ProjectRegistration> findRegistrationByProjectRef(String projectRef) {
        return Optional.ofNullable(mapper.findByProjectRef(projectRef)).map(row -> toRegistration(row, projectRef));
    }

    @Override
    public Optional<ProjectRegistration> findDefaultProfile(UUID projectId, String projectRef) {
        return Optional.ofNullable(mapper.findDefaultProfile(projectId)).map(row -> toRegistration(row, projectRef));
    }

    private ProjectRegistration toRegistration(ProjectRegistrationRow row, String projectRef) {
        return new ProjectRegistration(
                UUID.fromString(row.getProjectId()),
                UUID.fromString(row.getProfileId()),
                projectRef,
                row.getProfileName()
        );
    }

    @Override
    public ProjectRegistration insertDefaultProfile(UUID profileId, UUID projectId, String projectRef) {
        mapper.insertDefaultProfile(profileId, projectId);
        return new ProjectRegistration(projectId, profileId, projectRef, "黄金版 Claude 开发代理");
    }
}
