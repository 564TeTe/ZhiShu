package com.zhishu.project.persistence;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.UUID;

import org.junit.jupiter.api.Test;

import com.zhishu.project.ProjectRegistration;

class MyBatisProjectCatalogRepositoryTest {

    @Test
    void bootstrapsCompatibilityWorkspaceBindingWhenEnsuringProject() {
        UUID candidateId = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        ProjectCatalogMapper mapper = mock(ProjectCatalogMapper.class);
        when(mapper.ensureProject(candidateId, "D:\\demo", "Demo")).thenReturn(projectId.toString());

        UUID actual = new MyBatisProjectCatalogRepository(mapper)
                .ensureProject(candidateId, "D:\\demo", "Demo");

        assertThat(actual).isEqualTo(projectId);
        verify(mapper).ensureApprovalPolicy(projectId);
        verify(mapper).ensureCompatibilityWorkspaceBinding(projectId, "D:\\demo");
    }

    @Test
    void convertsTextUuidColumnsFromThePostgresMapper() {
        UUID projectId = UUID.randomUUID();
        UUID profileId = UUID.randomUUID();
        ProjectRegistrationRow row = new ProjectRegistrationRow();
        row.setProjectId(projectId.toString());
        row.setProfileId(profileId.toString());
        row.setProfileName("黄金版 Claude 开发代理");

        ProjectCatalogMapper mapper = mock(ProjectCatalogMapper.class);
        when(mapper.findDefaultProfile(projectId)).thenReturn(row);

        ProjectRegistration registration = new MyBatisProjectCatalogRepository(mapper)
                .findDefaultProfile(projectId, "D:\\demo")
                .orElseThrow();

        assertThat(registration.projectId()).isEqualTo(projectId);
        assertThat(registration.profileId()).isEqualTo(profileId);
        assertThat(registration.projectRef()).isEqualTo("D:\\demo");
    }

    @Test
    void resolvesDefaultProfileByProjectRef() {
        UUID projectId = UUID.randomUUID();
        UUID profileId = UUID.randomUUID();
        ProjectRegistrationRow row = new ProjectRegistrationRow();
        row.setProjectId(projectId.toString());
        row.setProfileId(profileId.toString());
        row.setProfileName("Default");

        ProjectCatalogMapper mapper = mock(ProjectCatalogMapper.class);
        when(mapper.findByProjectRef("D:\\demo")).thenReturn(row);

        ProjectRegistration registration = new MyBatisProjectCatalogRepository(mapper)
                .findRegistrationByProjectRef("D:\\demo")
                .orElseThrow();

        assertThat(registration.projectId()).isEqualTo(projectId);
        assertThat(registration.profileId()).isEqualTo(profileId);
        assertThat(registration.projectRef()).isEqualTo("D:\\demo");
    }
}
