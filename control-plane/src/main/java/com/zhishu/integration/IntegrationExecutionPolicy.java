package com.zhishu.integration;

import java.util.List;

/** Frozen server-owned build/test preset selected for one Integration Run. */
record IntegrationExecutionPolicy(
        String preset,
        List<String> buildCommand,
        List<String> testCommand
) {
    IntegrationExecutionPolicy {
        buildCommand = List.copyOf(buildCommand);
        testCommand = List.copyOf(testCommand);
    }

    String buildSummary() {
        return String.join(" ", buildCommand);
    }

    String testSummary() {
        return String.join(" ", testCommand);
    }
}
