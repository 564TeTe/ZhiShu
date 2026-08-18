package com.zhishu.approval;

import java.util.UUID;

import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import jakarta.validation.Valid;

/** Authenticated service-to-service approval commands used by the Task Center Gateway. */
@RestController
@RequestMapping("/internal/project-control/v1/approvals")
public class ProjectControlApprovalCommandController {

    private final ApprovalService approvals;

    public ProjectControlApprovalCommandController(ApprovalService approvals) {
        this.approvals = approvals;
    }

    @PostMapping("/{approvalId}/decision")
    public ApprovalView decide(
            @PathVariable UUID approvalId,
            @RequestHeader("X-Zhishu-Actor") String actor,
            @Valid @RequestBody ApprovalController.ApprovalDecisionRequest request
    ) {
        return approvals.decide(approvalId, request.decision(), request.message(), actor);
    }
}
