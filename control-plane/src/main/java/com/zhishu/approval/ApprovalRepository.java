package com.zhishu.approval;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface ApprovalRepository {

    Optional<ApprovalView> findById(UUID approvalId);

    List<ApprovalView> findPendingByTask(UUID taskId);

    boolean prepareDecision(UUID approvalId, ApprovalDecision decision);

    default boolean prepareDecision(UUID approvalId, ApprovalDecision decision, String source) {
        return prepareDecision(approvalId, decision);
    }

    void finalizeDecision(UUID approvalId, ApprovalDecision decision);

    default void finalizeDecision(UUID approvalId, ApprovalDecision decision, String finalStatus,
            String actor, String source, String policy, String rule, String reason) {
        finalizeDecision(approvalId, decision);
    }

    default List<ApprovalView> findExpired(int limit) { return List.of(); }
}
