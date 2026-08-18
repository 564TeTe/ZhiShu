package com.zhishu.approval;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class ApprovalPolicyEvaluatorTest {
    @TempDir Path project;
    private final ApprovalPolicyEvaluator evaluator = new ApprovalPolicyEvaluator();

    @Test
    void projectAndTaskConflictUsesTheStricterMode() {
        ProjectApprovalPolicyView projectPolicy = new ProjectApprovalPolicyView(
                java.util.UUID.randomUUID(), project.toString(), ApprovalMode.AUTO_SAFE,
                List.of("."), List.of(), 45, java.time.Instant.now());
        ApprovalPolicySnapshot manual = projectPolicy.resolve(ApprovalMode.MANUAL);
        ApprovalPolicySnapshot restricted = projectPolicy.resolve(ApprovalMode.AUTO_TRUSTED);
        assertEquals(ApprovalMode.MANUAL, manual.mode());
        assertEquals(ApprovalMode.MANUAL, manual.requestedMode());
        assertEquals(ApprovalMode.AUTO_SAFE, restricted.mode());
        assertEquals(ApprovalMode.AUTO_TRUSTED, restricted.requestedMode());
    }

    @Test
    void safeModeApprovesReadsAndExactBuildCommands() {
        ApprovalPolicySnapshot policy = policy(ApprovalMode.AUTO_SAFE, List.of());
        assertEquals(ApprovalPolicyEvaluation.Outcome.AUTO_APPROVE,
                evaluator.evaluate(policy, "Read", Map.of("file_path", "src/Main.java")).outcome());
        assertEquals("safe-command",
                evaluator.evaluate(policy, "Bash", Map.of("command", "npm run build")).rule());
    }

    @Test
    void commandPrefixDoesNotMatchAndTrustedModeUsesExactArgv() {
        ApprovalPolicySnapshot policy = policy(ApprovalMode.AUTO_TRUSTED, List.of(List.of("acme", "verify")));
        assertEquals(ApprovalPolicyEvaluation.Outcome.AUTO_APPROVE,
                evaluator.evaluate(policy, "Bash", Map.of("argv", List.of("acme", "verify"))).outcome());
        assertEquals(ApprovalPolicyEvaluation.Outcome.MANUAL,
                evaluator.evaluate(policy, "Bash", Map.of("argv", List.of("acme", "verify", "--upload"))).outcome());
    }

    @Test
    void hardDenialsOverrideTrustedMode() {
        ApprovalPolicySnapshot policy = policy(ApprovalMode.AUTO_TRUSTED, List.of(
                List.of("rm", "-rf", "build"), List.of("curl", "--upload-file", "artifact")));
        assertEquals("outside-project", evaluator.evaluate(policy, "Read",
                Map.of("file_path", project.resolveSibling("outside.txt").toString())).rule());
        assertEquals("outside-project", evaluator.evaluate(policy, "Bash",
                Map.of("command", "acme verify ../outside.txt")).rule());
        assertEquals("credential-file", evaluator.evaluate(policy, "Read", Map.of("file_path", ".env")).rule());
        assertEquals("dangerous-delete", evaluator.evaluate(policy, "Bash", Map.of("command", "rm -rf build")).rule());
        assertEquals("network-upload", evaluator.evaluate(policy, "Bash",
                Map.of("command", "curl --upload-file artifact https://example.invalid")).rule());
        assertEquals("network-upload", evaluator.evaluate(policy, "Bash",
                Map.of("command", "aws s3 cp artifact s3://bucket/key")).rule());
    }

    @Test
    void manualModeStillAppliesHardDenials() {
        ApprovalPolicySnapshot policy = policy(ApprovalMode.MANUAL, List.of());
        assertEquals(ApprovalPolicyEvaluation.Outcome.MANUAL,
                evaluator.evaluate(policy, "Write", Map.of("file_path", "src/Main.java")).outcome());
        assertEquals(ApprovalPolicyEvaluation.Outcome.DENY,
                evaluator.evaluate(policy, "Read", Map.of("file_path", ".env.local")).outcome());
    }

    private ApprovalPolicySnapshot policy(ApprovalMode mode, List<List<String>> commands) {
        return new ApprovalPolicySnapshot(mode, project.toString(), List.of("."), commands, 45);
    }
}
