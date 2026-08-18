package com.zhishu.project;

import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ProjectCatalogService {

    private final ProjectCatalogRepository projects;

    public ProjectCatalogService(ProjectCatalogRepository projects) {
        this.projects = projects;
    }

    @Transactional
    public ProjectRegistration ensure(UUID candidateId, String projectRef, String displayName) {
        UUID projectId = projects.ensureProject(candidateId, projectRef.trim(), displayName.trim());
        return projects.findDefaultProfile(projectId, projectRef)
                .orElseGet(() -> projects.insertDefaultProfile(UUID.randomUUID(), projectId, projectRef));
    }

    public ProjectRegistration resolve(String projectRef) {
        if (projectRef == null || projectRef.isBlank()) {
            throw new IllegalArgumentException("projectRef is required");
        }
        String normalizedProjectRef = projectRef.trim();
        return projects.findRegistrationByProjectRef(normalizedProjectRef)
                .orElseThrow(() -> new ProjectRegistrationNotFoundException(normalizedProjectRef));
    }
}
