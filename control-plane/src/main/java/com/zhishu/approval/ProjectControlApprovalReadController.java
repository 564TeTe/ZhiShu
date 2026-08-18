package com.zhishu.approval;

import java.util.List;
import java.util.UUID;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/internal/project-control/v1")
public class ProjectControlApprovalReadController {

    private final ApprovalService approvals;
    private final ProjectApprovalPolicyService policies;

    public ProjectControlApprovalReadController(
            ApprovalService approvals,
            ProjectApprovalPolicyService policies
    ) {
        this.approvals = approvals;
        this.policies = policies;
    }

    @GetMapping("/tasks/{taskId}/approvals")
    public List<ApprovalView> pending(@PathVariable UUID taskId) {
        return approvals.pendingForTask(taskId);
    }

    @GetMapping("/projects/{projectId}/approval-policy")
    public ProjectApprovalPolicyView policy(@PathVariable UUID projectId) {
        return policies.get(projectId);
    }
}
