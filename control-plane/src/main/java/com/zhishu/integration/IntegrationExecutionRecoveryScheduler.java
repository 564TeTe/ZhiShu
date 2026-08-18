package com.zhishu.integration;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** Reconciles Integration Runs left in an active state by a Control Plane restart. */
@Component
@ConditionalOnProperty(
        name = "zhishu.integration.execution.recovery-enabled",
        havingValue = "true",
        matchIfMissing = true
)
public class IntegrationExecutionRecoveryScheduler {

    private final IntegrationExecutionService executions;

    public IntegrationExecutionRecoveryScheduler(IntegrationExecutionService executions) {
        this.executions = executions;
    }

    @Scheduled(fixedDelayString = "${zhishu.integration.execution.recovery-delay:30s}")
    public void reconcile() {
        executions.recoverInterruptedRuns();
    }
}
