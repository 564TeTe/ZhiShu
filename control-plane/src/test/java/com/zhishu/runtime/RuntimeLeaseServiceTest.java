package com.zhishu.runtime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.Test;

import com.zhishu.event.AttemptProjectionRepository;
import com.zhishu.event.AttemptProjectionState;
import com.zhishu.task.AttemptStatus;
import com.zhishu.task.TaskRepository;
import com.zhishu.task.TaskStateMachine;

class RuntimeLeaseServiceTest {

    private static final Instant NOW = Instant.parse("2026-08-15T12:00:00Z");
    private static final RuntimeLeaseProperties PROPERTIES = new RuntimeLeaseProperties(
            Duration.ofSeconds(30), Duration.ofSeconds(60)
    );

    @Test
    void recordsAuthenticatedActivityUsingControlPlaneTime() {
        AttemptRuntimeHealthRepository health = mock(AttemptRuntimeHealthRepository.class);
        UUID attemptId = UUID.randomUUID();

        service(health, mock(AttemptProjectionRepository.class), mock(TaskRepository.class)).observe(attemptId, NOW);

        verify(health).observe(attemptId, NOW, NOW.plusSeconds(30));
    }

    @Test
    void staleOutboxHeartbeatCannotReviveRunAfterNodeRestart() {
        AttemptRuntimeHealthRepository health = mock(AttemptRuntimeHealthRepository.class);
        UUID attemptId = UUID.randomUUID();

        service(health, mock(AttemptProjectionRepository.class), mock(TaskRepository.class))
                .observe(attemptId, NOW.minusSeconds(31));

        verify(health, never()).observe(
                org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any()
        );
    }

    @Test
    void transientExpiryBecomesUnknownWithoutEndingAttempt() {
        AttemptRuntimeHealthRepository health = mock(AttemptRuntimeHealthRepository.class);
        AttemptProjectionRepository attempts = mock(AttemptProjectionRepository.class);
        TaskRepository tasks = mock(TaskRepository.class);
        when(health.markExpiredUnknown(NOW, NOW.minusSeconds(30), NOW)).thenReturn(1);
        when(health.findLostCandidates(NOW.minusSeconds(60))).thenReturn(List.of());

        RuntimeLeaseService.RuntimeLeaseSweepResult result = service(health, attempts, tasks).sweep();

        assertThat(result).isEqualTo(new RuntimeLeaseService.RuntimeLeaseSweepResult(1, 0));
        verify(attempts, never()).transition(
                org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any()
        );
    }

    @Test
    void expiredUnknownAttemptBecomesExplicitLostAndUpdatesCurrentTask() {
        AttemptRuntimeHealthRepository health = mock(AttemptRuntimeHealthRepository.class);
        AttemptProjectionRepository attempts = mock(AttemptProjectionRepository.class);
        TaskRepository tasks = mock(TaskRepository.class);
        UUID attemptId = UUID.randomUUID();
        UUID taskId = UUID.randomUUID();
        RuntimeLeaseCandidate candidate = new RuntimeLeaseCandidate(attemptId, taskId, AttemptStatus.RUNNING);
        when(health.findLostCandidates(NOW.minusSeconds(60))).thenReturn(List.of(candidate));
        when(attempts.lock(attemptId)).thenReturn(Optional.of(
                new AttemptProjectionState(attemptId, taskId, AttemptStatus.RUNNING)
        ));
        when(health.markLost(attemptId, NOW.minusSeconds(60), NOW, RuntimeLeaseService.LOST_REASON))
                .thenReturn(true);
        when(attempts.transition(
                attemptId, AttemptStatus.RUNNING, AttemptStatus.LOST, NOW,
                RuntimeLeaseService.LOST_ERROR_CODE, RuntimeLeaseService.LOST_REASON
        )).thenReturn(true);
        List<String> observed = new ArrayList<>();
        RuntimeLeaseService service = new RuntimeLeaseService(
                health, attempts, tasks, new TaskStateMachine(), PROPERTIES,
                List.of(
                        (task, attempt, status) -> observed.add("first:" + status),
                        (task, attempt, status) -> observed.add("second:" + status)
                ),
                Clock.fixed(NOW, ZoneOffset.UTC)
        );

        RuntimeLeaseService.RuntimeLeaseSweepResult result = service.sweep();

        assertThat(result.markedLost()).isEqualTo(1);
        assertThat(observed).containsExactly("first:LOST", "second:LOST");
        verify(tasks).updateStatusForAttempt(taskId, attemptId, AttemptStatus.LOST);
    }

    @Test
    void heartbeatWinningTheRacePreventsLostTransition() {
        AttemptRuntimeHealthRepository health = mock(AttemptRuntimeHealthRepository.class);
        AttemptProjectionRepository attempts = mock(AttemptProjectionRepository.class);
        TaskRepository tasks = mock(TaskRepository.class);
        UUID attemptId = UUID.randomUUID();
        UUID taskId = UUID.randomUUID();
        RuntimeLeaseCandidate candidate = new RuntimeLeaseCandidate(attemptId, taskId, AttemptStatus.RUNNING);
        when(health.findLostCandidates(NOW.minusSeconds(60))).thenReturn(List.of(candidate));
        when(attempts.lock(attemptId)).thenReturn(Optional.of(
                new AttemptProjectionState(attemptId, taskId, AttemptStatus.RUNNING)
        ));
        when(health.markLost(attemptId, NOW.minusSeconds(60), NOW, RuntimeLeaseService.LOST_REASON))
                .thenReturn(false);

        RuntimeLeaseService.RuntimeLeaseSweepResult result = service(health, attempts, tasks).sweep();

        assertThat(result.markedLost()).isZero();
        verify(attempts, never()).transition(
                org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any()
        );
        verify(tasks, never()).updateStatusForAttempt(taskId, attemptId, AttemptStatus.LOST);
    }

    private RuntimeLeaseService service(
            AttemptRuntimeHealthRepository health,
            AttemptProjectionRepository attempts,
            TaskRepository tasks
    ) {
        return new RuntimeLeaseService(
                health, attempts, tasks, new TaskStateMachine(), PROPERTIES,
                Clock.fixed(NOW, ZoneOffset.UTC)
        );
    }
}
