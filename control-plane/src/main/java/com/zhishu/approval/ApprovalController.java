package com.zhishu.approval;

import java.util.List;
import java.util.UUID;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

@RestController
@RequestMapping("/api/v1")
public class ApprovalController {

    private final ApprovalService approvals;

    public ApprovalController(ApprovalService approvals) {
        this.approvals = approvals;
    }

    @GetMapping("/tasks/{taskId}/approvals")
    public List<ApprovalView> pending(@PathVariable UUID taskId) {
        return approvals.pendingForTask(taskId);
    }

    @PostMapping("/approvals/{approvalId}/decision")
    public ApprovalView decide(
            @PathVariable UUID approvalId,
            @Valid @RequestBody ApprovalDecisionRequest request
    ) {
        return approvals.decide(approvalId, request.decision(), request.message());
    }

    public record ApprovalDecisionRequest(@NotNull ApprovalDecision decision, String message) {
    }
}
