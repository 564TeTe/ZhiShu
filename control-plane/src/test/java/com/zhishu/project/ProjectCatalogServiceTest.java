package com.zhishu.project;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.Test;

class ProjectCatalogServiceTest {

    @Test
    void reusesExistingProjectProfileRegistration() {
        UUID projectId = UUID.randomUUID();
        UUID profileId = UUID.randomUUID();
        ProjectRegistration expected = new ProjectRegistration(projectId, profileId, "D:\\demo", "Default");
        ProjectCatalogRepository repository = new ProjectCatalogRepository() {
            @Override public UUID ensureProject(UUID candidateId, String projectRef, String displayName) { return projectId; }
            @Override public Optional<ProjectRegistration> findRegistrationByProjectRef(String projectRef) { return Optional.empty(); }
            @Override public Optional<ProjectRegistration> findDefaultProfile(UUID id, String projectRef) { return Optional.of(expected); }
            @Override public ProjectRegistration insertDefaultProfile(UUID id, UUID project, String ref) { throw new AssertionError(); }
        };

        assertThat(new ProjectCatalogService(repository).ensure(UUID.randomUUID(), " D:\\demo ", " Demo "))
                .isEqualTo(expected);
    }

    @Test
    void resolvesExistingRegistrationWithoutWriting() {
        ProjectRegistration expected = new ProjectRegistration(
                UUID.randomUUID(), UUID.randomUUID(), "D:\\demo", "Default"
        );
        ProjectCatalogRepository repository = new ProjectCatalogRepository() {
            @Override public UUID ensureProject(UUID candidateId, String projectRef, String displayName) { throw new AssertionError(); }
            @Override public Optional<ProjectRegistration> findRegistrationByProjectRef(String projectRef) {
                return projectRef.equals("D:\\demo") ? Optional.of(expected) : Optional.empty();
            }
            @Override public Optional<ProjectRegistration> findDefaultProfile(UUID id, String projectRef) { throw new AssertionError(); }
            @Override public ProjectRegistration insertDefaultProfile(UUID id, UUID project, String ref) { throw new AssertionError(); }
        };

        ProjectCatalogService service = new ProjectCatalogService(repository);
        assertThat(service.resolve(" D:\\demo ")).isEqualTo(expected);
        assertThatThrownBy(() -> service.resolve("D:\\missing"))
                .isInstanceOf(ProjectRegistrationNotFoundException.class);
    }
}
