package com.zhishu.project;

import java.util.Optional;
import java.util.UUID;

public interface ProjectCatalogRepository {

    UUID ensureProject(UUID candidateId, String projectRef, String displayName);

    Optional<ProjectRegistration> findRegistrationByProjectRef(String projectRef);

    Optional<ProjectRegistration> findDefaultProfile(UUID projectId, String projectRef);

    ProjectRegistration insertDefaultProfile(UUID profileId, UUID projectId, String projectRef);
}
