package com.zhishu.integration;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

import com.zhishu.task.AttemptStatus;

class IntegrationAgentProjectionServiceTest {

    @Test
    void mapsAttemptLifecycleToDurableIntegrationAgentStates() {
        assertThat(IntegrationAgentProjectionService.projectedStatus(AttemptStatus.PENDING)).isNull();
        assertThat(IntegrationAgentProjectionService.projectedStatus(AttemptStatus.STARTING)).isNull();
        assertThat(IntegrationAgentProjectionService.projectedStatus(AttemptStatus.RUNNING)).isEqualTo("RUNNING");
        assertThat(IntegrationAgentProjectionService.projectedStatus(AttemptStatus.WAITING_APPROVAL))
                .isEqualTo("RUNNING");
        assertThat(IntegrationAgentProjectionService.projectedStatus(AttemptStatus.CANCELLING))
                .isEqualTo("RUNNING");
        assertThat(IntegrationAgentProjectionService.projectedStatus(AttemptStatus.SUCCEEDED))
                .isEqualTo("SUCCEEDED");
        assertThat(IntegrationAgentProjectionService.projectedStatus(AttemptStatus.FAILED)).isEqualTo("FAILED");
        assertThat(IntegrationAgentProjectionService.projectedStatus(AttemptStatus.LOST)).isEqualTo("FAILED");
        assertThat(IntegrationAgentProjectionService.projectedStatus(AttemptStatus.ABORTED)).isEqualTo("CANCELLED");
    }
}
