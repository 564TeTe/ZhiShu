package com.zhishu.approval;

import java.time.Clock;
import java.util.List;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.zhishu.runtime.RuntimeApprovalDecisionCommand;
import com.zhishu.runtime.RuntimeClient;
import com.zhishu.task.AttemptStatus;
import com.zhishu.task.TaskNotFoundException;

@Service
public class ApprovalService {
    private final ApprovalRepository approvals;
    private final RuntimeClient runtimeClient;
    private final ApprovalPolicyEvaluator evaluator;
    private final Clock clock;

    @Autowired
    public ApprovalService(
            ApprovalRepository approvals,
            RuntimeClient runtimeClient,
            ApprovalPolicyEvaluator evaluator
    ) {
        this(approvals, runtimeClient, evaluator, Clock.systemUTC());
    }

    ApprovalService(ApprovalRepository approvals, RuntimeClient runtimeClient,
            ApprovalPolicyEvaluator evaluator, Clock clock) {
        this.approvals = approvals;
        this.runtimeClient = runtimeClient;
        this.evaluator = evaluator;
        this.clock = clock;
    }

    ApprovalService(ApprovalRepository approvals, RuntimeClient runtimeClient) {
        this(approvals, runtimeClient, new ApprovalPolicyEvaluator(), Clock.systemUTC());
    }

    public List<ApprovalView> pendingForTask(UUID taskId) {
        return approvals.findPendingByTask(taskId);
    }

    @Transactional
    public ApprovalView decide(UUID approvalId, ApprovalDecision requested, String message) {
        return decide(approvalId, requested, message, "user");
    }

    @Transactional
    public ApprovalView decide(UUID approvalId, ApprovalDecision requested, String message, String actor) {
        ApprovalView approval = require(approvalId);
        ApprovalPolicyEvaluation evaluation = evaluator.evaluate(
                approval.approvalPolicySnapshot(), approval.toolName(), approval.toolInput());
        if (requested == ApprovalDecision.APPROVED
                && evaluation.outcome() == ApprovalPolicyEvaluation.Outcome.DENY) {
            return resolve(approval, ApprovalDecision.DENIED, "DENIED", "policy", "POLICY_DENY",
                    evaluation.rule(), evaluation.reason());
        }
        return resolve(approval, requested, requested.name(), requireActor(actor), "MANUAL",
                "manual-decision", message == null || message.isBlank() ? "User decision" : message);
    }

    public void processPendingForTask(UUID taskId) {
        for (ApprovalView approval : approvals.findPendingByTask(taskId)) {
            if (!List.of("PENDING", "AUTO_APPROVING", "DENYING").contains(approval.status())) continue;
            ApprovalPolicyEvaluation evaluation = evaluator.evaluate(
                    approval.approvalPolicySnapshot(), approval.toolName(), approval.toolInput());
            try {
                if (evaluation.outcome() == ApprovalPolicyEvaluation.Outcome.AUTO_APPROVE) {
                    resolve(approval, ApprovalDecision.APPROVED, "AUTO_APPROVED", "approval-policy",
                            "AUTO_POLICY", evaluation.rule(), evaluation.reason());
                } else if (evaluation.outcome() == ApprovalPolicyEvaluation.Outcome.DENY) {
                    resolve(approval, ApprovalDecision.DENIED, "DENIED", "approval-policy",
                            "POLICY_DENY", evaluation.rule(), evaluation.reason());
                }
            } catch (ApprovalConflictException ignored) {
                // A user decision or timeout won the compare-and-set.
            }
        }
    }

    public void denyExpired() {
        for (ApprovalView approval : approvals.findExpired(100)) {
            try {
                resolve(approval, ApprovalDecision.DENIED, "EXPIRED", "system:approval-timeout",
                        "TIMEOUT", "approval-timeout", "Approval timed out and was denied by default");
            } catch (RuntimeException ignored) {
                // A concurrent decision wins, or the Runtime call remains retryable on the next scan.
            }
        }
    }

    private ApprovalView resolve(ApprovalView approval, ApprovalDecision runtimeDecision, String finalStatus,
            String actor, String source, String rule, String reason) {
        if (approval.status().equals(finalStatus)) return approval;
        String preparing = preparingStatus(runtimeDecision, source);
        boolean exactReplay = approval.status().equals(preparing);
        if (!exactReplay) {
            boolean timeoutClaim = "TIMEOUT".equals(source)
                    && List.of("PENDING", "APPROVING", "DENYING", "AUTO_APPROVING").contains(approval.status());
            if (approval.attemptStatus() != AttemptStatus.WAITING_APPROVAL
                    || (!approval.status().equals("PENDING") && !timeoutClaim)) {
                throw new ApprovalConflictException("Approval is no longer pending");
            }
            if (approval.expiresAt() != null && !approval.expiresAt().isAfter(clock.instant())
                    && !"TIMEOUT".equals(source)) {
                throw new ApprovalConflictException("Approval has expired");
            }
            if (!approvals.prepareDecision(approval.id(), runtimeDecision, source)) {
                throw new ApprovalConflictException("Approval changed concurrently");
            }
        }
        String policy = approval.approvalPolicySnapshot().mode().name();
        runtimeClient.decideApproval(approval.runtimeRunId(), approval.runtimeApprovalId(),
                new RuntimeApprovalDecisionCommand(
                        "1.0", UUID.randomUUID().toString(), approval.id() + ":" + finalStatus,
                        runtimeDecision.name(), reason, source, policy, rule, reason
                ));
        approvals.finalizeDecision(approval.id(), runtimeDecision, finalStatus,
                actor, source, policy, rule, reason);
        return require(approval.id());
    }

    private ApprovalView require(UUID approvalId) {
        return approvals.findById(approvalId)
                .orElseThrow(() -> new TaskNotFoundException("Approval was not found: " + approvalId));
    }

    private String requireActor(String actor) {
        if (actor == null || actor.isBlank()) {
            throw new IllegalArgumentException("Approval actor is required");
        }
        return actor.trim();
    }

    private String preparingStatus(ApprovalDecision decision, String source) {
        if ("AUTO_POLICY".equals(source)) return "AUTO_APPROVING";
        if ("TIMEOUT".equals(source)) return "EXPIRING";
        return decision == ApprovalDecision.APPROVED ? "APPROVING" : "DENYING";
    }
}
