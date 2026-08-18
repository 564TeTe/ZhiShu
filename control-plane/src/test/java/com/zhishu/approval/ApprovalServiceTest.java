package com.zhishu.approval;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.Test;

import com.zhishu.runtime.RuntimeAccepted;
import com.zhishu.runtime.RuntimeApprovalDecisionCommand;
import com.zhishu.runtime.RuntimeApprovalDecisionResult;
import com.zhishu.runtime.RuntimeClient;
import com.zhishu.runtime.RuntimeStartCommand;
import com.zhishu.task.AttemptStatus;

class ApprovalServiceTest {

    @Test
    void preparesDecisionBeforeRuntimeAndFinalizesAfterAcceptance() {
        RecordingApprovalRepository repository = new RecordingApprovalRepository(AttemptStatus.WAITING_APPROVAL);
        RecordingRuntimeClient runtime = new RecordingRuntimeClient(repository);
        ApprovalService service = new ApprovalService(repository, runtime);

        ApprovalView result = service.decide(repository.approval.id(), ApprovalDecision.APPROVED, "safe");

        assertThat(runtime.statusObserved).isEqualTo("APPROVING");
        assertThat(runtime.command.idempotencyKey()).isEqualTo(repository.approval.id() + ":APPROVED");
        assertThat(result.status()).isEqualTo("APPROVED");
    }

    @Test
    void rejectsApprovalAfterCancellationHasWon() {
        RecordingApprovalRepository repository = new RecordingApprovalRepository(AttemptStatus.CANCELLING);
        ApprovalService service = new ApprovalService(repository, new RecordingRuntimeClient(repository));

        assertThatThrownBy(() -> service.decide(
                repository.approval.id(), ApprovalDecision.APPROVED, null
        )).isInstanceOf(ApprovalConflictException.class);
        assertThat(repository.approval.status()).isEqualTo("PENDING");
    }

    @Test
    void matchingFinalDecisionReturnsWithoutCallingRuntimeAgain() {
        RecordingApprovalRepository repository = new RecordingApprovalRepository(AttemptStatus.RUNNING);
        repository.finalizeDecision(repository.approval.id(), ApprovalDecision.APPROVED);
        RecordingRuntimeClient runtime = new RecordingRuntimeClient(repository);
        ApprovalService service = new ApprovalService(repository, runtime);

        ApprovalView replay = service.decide(repository.approval.id(), ApprovalDecision.APPROVED, "duplicate");

        assertThat(replay.status()).isEqualTo("APPROVED");
        assertThat(runtime.callCount).isZero();
    }

    private static final class RecordingApprovalRepository implements ApprovalRepository {
        private ApprovalView approval;

        private RecordingApprovalRepository(AttemptStatus attemptStatus) {
            approval = new ApprovalView(
                    UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), "run-1", "runtime-approval-1",
                    "Write", Map.of("path", "demo.txt"), "MEDIUM", "PENDING", attemptStatus,
                    null, null, Instant.parse("2026-08-12T00:00:00Z")
            );
        }

        @Override public Optional<ApprovalView> findById(UUID approvalId) { return Optional.of(approval); }
        @Override public List<ApprovalView> findPendingByTask(UUID taskId) { return List.of(approval); }
        @Override public boolean prepareDecision(UUID approvalId, ApprovalDecision decision) {
            approval = copy(decision == ApprovalDecision.APPROVED ? "APPROVING" : "DENYING");
            return true;
        }
        @Override public void finalizeDecision(UUID approvalId, ApprovalDecision decision) {
            approval = copy(decision.name());
        }

        private ApprovalView copy(String status) {
            return new ApprovalView(
                    approval.id(), approval.taskId(), approval.attemptId(), approval.runtimeRunId(),
                    approval.runtimeApprovalId(), approval.toolName(), approval.toolInput(), approval.riskLevel(),
                    status, approval.attemptStatus(), approval.expiresAt(), approval.decidedAt(), approval.createdAt()
            );
        }
    }

    private static final class RecordingRuntimeClient implements RuntimeClient {
        private final RecordingApprovalRepository repository;
        private String statusObserved;
        private RuntimeApprovalDecisionCommand command;
        private int callCount;

        private RecordingRuntimeClient(RecordingApprovalRepository repository) {
            this.repository = repository;
        }

        @Override public RuntimeAccepted start(RuntimeStartCommand command) { throw new UnsupportedOperationException(); }
        @Override public RuntimeApprovalDecisionResult decideApproval(
                String runtimeRunId,
                String runtimeApprovalId,
                RuntimeApprovalDecisionCommand command
        ) {
            callCount += 1;
            this.statusObserved = repository.approval.status();
            this.command = command;
            return new RuntimeApprovalDecisionResult(runtimeRunId, runtimeApprovalId, command.decision());
        }
    }
}
