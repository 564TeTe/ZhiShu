package com.zhishu.approval;

import java.util.List;
import java.util.UUID;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;

@RestController
@RequestMapping("/api/v1/projects/{projectId}/approval-policy")
public class ProjectApprovalPolicyController {
    private final ProjectApprovalPolicyService policies;

    public ProjectApprovalPolicyController(ProjectApprovalPolicyService policies) {
        this.policies = policies;
    }

    @GetMapping
    public ProjectApprovalPolicyView get(@PathVariable UUID projectId) {
        return policies.get(projectId);
    }

    @PutMapping
    public ProjectApprovalPolicyView update(
            @PathVariable UUID projectId,
            @Valid @RequestBody UpdateApprovalPolicyRequest request
    ) {
        return policies.update(projectId, request.mode(), request.allowedDirectories(),
                request.trustedCommands(), request.approvalTimeoutSeconds());
    }

    public record UpdateApprovalPolicyRequest(
            @NotNull ApprovalMode mode,
            List<String> allowedDirectories,
            List<List<String>> trustedCommands,
            @Min(5) @Max(300) int approvalTimeoutSeconds
    ) { }
}
