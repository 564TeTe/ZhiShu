package com.zhishu.profile;

import java.util.Objects;
import java.util.Set;

public record AgentProfileSnapshot(
        ExecutorType executor,
        String connectionRef,
        String modelAlias,
        Set<Capability> capabilities,
        Set<Capability> requireApprovalFor,
        int timeoutSeconds,
        String promptVersion
) {
    public AgentProfileSnapshot(
            ExecutorType executor,
            String modelAlias,
            Set<Capability> capabilities,
            Set<Capability> requireApprovalFor,
            int timeoutSeconds,
            String promptVersion
    ) {
        this(executor, null, modelAlias, capabilities, requireApprovalFor, timeoutSeconds, promptVersion);
    }

    public AgentProfileSnapshot withConnectionRef(String connectionRef) {
        return new AgentProfileSnapshot(
                executor, connectionRef, modelAlias, capabilities, requireApprovalFor, timeoutSeconds, promptVersion
        );
    }

    public AgentProfileSnapshot withExecutor(ExecutorType newExecutor) {
        return new AgentProfileSnapshot(
                newExecutor, connectionRef, modelAlias, capabilities, requireApprovalFor, timeoutSeconds, promptVersion
        );
    }

    public AgentProfileSnapshot withModelAlias(String newModelAlias) {
        return new AgentProfileSnapshot(
                executor, connectionRef, newModelAlias, capabilities, requireApprovalFor, timeoutSeconds, promptVersion
        );
    }

    public AgentProfileSnapshot asReadOnly() {
        Set<Capability> readOnlyCapabilities = capabilities.stream()
                .filter(capability -> capability == Capability.READ_FILE || capability == Capability.SEARCH_CODE)
                .collect(java.util.stream.Collectors.toUnmodifiableSet());
        return new AgentProfileSnapshot(
                executor, null, modelAlias, readOnlyCapabilities, Set.of(), timeoutSeconds, promptVersion
        );
    }

    public AgentProfileSnapshot {
        Objects.requireNonNull(executor, "executor");
        capabilities = Set.copyOf(Objects.requireNonNull(capabilities, "capabilities"));
        requireApprovalFor = Set.copyOf(Objects.requireNonNull(requireApprovalFor, "requireApprovalFor"));
        Objects.requireNonNull(promptVersion, "promptVersion");

        if (!capabilities.containsAll(requireApprovalFor)) {
            throw new IllegalArgumentException("Approval policy cannot reference a disabled capability");
        }
        if (timeoutSeconds <= 0) {
            throw new IllegalArgumentException("timeoutSeconds must be positive");
        }
        if (promptVersion.isBlank()) {
            throw new IllegalArgumentException("promptVersion is required");
        }
    }
}
