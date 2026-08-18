package com.zhishu.approval;

import java.util.Optional;
import java.util.UUID;

public interface ProjectApprovalPolicyRepository {
    Optional<ProjectApprovalPolicyView> findByProjectId(UUID projectId);

    ProjectApprovalPolicyView save(ProjectApprovalPolicyView policy);
}
