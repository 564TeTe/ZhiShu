package com.zhishu.task;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

class TaskStateMachineTest {

    private final TaskStateMachine stateMachine = new TaskStateMachine();

    @Test
    void allowsGoldenCoreLifecycleTransitions() {
        assertThat(stateMachine.canTransition(AttemptStatus.PENDING, AttemptStatus.STARTING)).isTrue();
        assertThat(stateMachine.canTransition(AttemptStatus.STARTING, AttemptStatus.RUNNING)).isTrue();
        assertThat(stateMachine.canTransition(AttemptStatus.RUNNING, AttemptStatus.WAITING_APPROVAL)).isTrue();
        assertThat(stateMachine.canTransition(AttemptStatus.WAITING_APPROVAL, AttemptStatus.RUNNING)).isTrue();
        assertThat(stateMachine.canTransition(AttemptStatus.RUNNING, AttemptStatus.CANCELLING)).isTrue();
        assertThat(stateMachine.canTransition(AttemptStatus.RUNNING, AttemptStatus.LOST)).isTrue();
        assertThat(stateMachine.canTransition(AttemptStatus.CANCELLING, AttemptStatus.ABORTED)).isTrue();
    }

    @Test
    void rejectsSkippingStartingAfterHttpAcceptance() {
        assertThatThrownBy(() -> stateMachine.requireTransition(AttemptStatus.PENDING, AttemptStatus.RUNNING))
                .isInstanceOf(InvalidTaskStateException.class)
                .hasMessageContaining("PENDING -> RUNNING");
    }

    @Test
    void terminalAttemptsCannotBeRestarted() {
        for (AttemptStatus terminal : new AttemptStatus[]{
                AttemptStatus.SUCCEEDED,
                AttemptStatus.FAILED,
                AttemptStatus.LOST,
                AttemptStatus.ABORTED
        }) {
            assertThat(stateMachine.canTransition(terminal, AttemptStatus.RUNNING)).isFalse();
        }
    }
}
