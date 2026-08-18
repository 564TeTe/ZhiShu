package com.zhishu.integration;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record IntegrationExecutionView(
        UUID runId,
        UUID projectId,
        UUID planId,
        UUID gateId,
        int attemptNumber,
        String status,
        String repositoryRoot,
        String baseCommit,
        String candidateCommit,
        String integrationWorkspacePath,
        String integrationBranchRef,
        String workspaceState,
        String failureCode,
        String failureMessage,
        Integer buildExitCode,
        Integer testExitCode,
        UUID replanProposalId,
        String finalizationState,
        String finalizedTargetRef,
        Instant finalizedAt,
        String finalizationFailureMessage,
        String policyPreset,
        String buildCommandSummary,
        String testCommandSummary,
        String createdBy,
        Instant createdAt,
        Instant startedAt,
        Instant completedAt,
        boolean replayed,
        List<StepView> steps
) {
    public record StepView(
            UUID stepId,
            int ordinal,
            String stepType,
            UUID assignmentId,
            String status,
            String commandSummary,
            Integer exitCode,
            String stdoutSummary,
            String stderrSummary,
            Instant startedAt,
            Instant completedAt
    ) {
    }
}
