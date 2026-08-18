package com.zhishu.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.zhishu.workspace.GitCommandRunner;
import com.zhishu.workspace.WorkspaceProvisionerProperties;

class GitIntegrationWorkspacePortTest {

    @TempDir
    Path temporaryRoot;

    private Path repository;
    private Path provisioningRoot;
    private GitCommandRunner git;
    private GitIntegrationWorkspacePort port;
    private String baseCommit;

    @BeforeEach
    void createRepository() throws Exception {
        repository = temporaryRoot.resolve("repository");
        provisioningRoot = temporaryRoot.resolve("provisioning");
        Files.createDirectories(repository);
        run(repository, List.of("git", "init"));
        Files.writeString(repository.resolve("tracked.txt"), "baseline\n");
        run(repository, List.of("git", "add", "tracked.txt"));
        run(repository, List.of("git", "commit", "-m", "baseline"));
        WorkspaceProvisionerProperties properties = new WorkspaceProvisionerProperties(
                provisioningRoot, Duration.ofSeconds(30), Duration.ofMinutes(5),
                Duration.ofSeconds(1), "git"
        );
        git = new GitCommandRunner(properties);
        port = new GitIntegrationWorkspacePort(properties, git, new ObjectMapper());
        baseCommit = git.requireSuccess(repository, List.of("rev-parse", "--verify", "HEAD^{commit}"))
                .stdout().trim();
    }

    @Test
    void fastForwardsTheCleanPrimaryBranchAndCleansTheOwnedWorktreeIdempotently() throws Exception {
        UUID runId = UUID.randomUUID();
        UUID gateId = UUID.randomUUID();
        Path target = provisioningRoot.resolve("integration").resolve("run-" + runId);
        String branch = "zhishu/integration/" + gateId.toString().substring(0, 8)
                + "/" + runId.toString().substring(0, 8);
        String token = "owned-token";
        port.create(new GitIntegrationWorkspacePort.CreateRequest(
                runId, gateId, repository, baseCommit, target, branch, token
        ));
        Files.writeString(target.resolve("tracked.txt"), "candidate\n");
        git.requireSuccess(target, List.of("add", "tracked.txt"));
        git.requireSuccess(target, List.of("commit", "-m", "integration candidate"), Map.of(
                "GIT_AUTHOR_NAME", "Zhishu Test",
                "GIT_AUTHOR_EMAIL", "zhishu-test@example.invalid",
                "GIT_COMMITTER_NAME", "Zhishu Test",
                "GIT_COMMITTER_EMAIL", "zhishu-test@example.invalid"
        ));
        String candidate = git.requireSuccess(target, List.of("rev-parse", "--verify", "HEAD^{commit}"))
                .stdout().trim();
        GitIntegrationWorkspacePort.FinalizeRequest request = new GitIntegrationWorkspacePort.FinalizeRequest(
                runId, repository, baseCommit, candidate, target, branch, token
        );

        GitIntegrationWorkspacePort.FinalizationResult applied = port.fastForwardPrimary(request);
        GitIntegrationWorkspacePort.FinalizationResult replay = port.fastForwardPrimary(request);

        assertThat(applied.replayed()).isFalse();
        assertThat(replay.replayed()).isTrue();
        assertThat(applied.targetRef()).isNotBlank();
        assertThat(Files.readString(repository.resolve("tracked.txt"))).isEqualTo("candidate\n");
        assertThat(git.requireSuccess(repository, List.of("rev-parse", "--verify", "HEAD^{commit}"))
                .stdout().trim()).isEqualTo(candidate);
        assertThat(git.requireSuccess(repository, List.of(
                "status", "--porcelain=v1", "--untracked-files=all"
        )).stdout()).isBlank();

        GitIntegrationWorkspacePort.CleanupRequest cleanup = new GitIntegrationWorkspacePort.CleanupRequest(
                runId, repository, target, branch, token
        );
        port.cleanup(cleanup);
        port.cleanup(cleanup);

        assertThat(Files.exists(target)).isFalse();
        assertThat(git.run(repository, List.of(
                "show-ref", "--verify", "--quiet", "refs/heads/" + branch
        )).exitCode()).isEqualTo(1);
    }

    @Test
    void refusesToFinalizeWhenThePrimaryWorktreeIsDirty() throws Exception {
        UUID runId = UUID.randomUUID();
        UUID gateId = UUID.randomUUID();
        Path target = provisioningRoot.resolve("integration").resolve("run-" + runId);
        String branch = "zhishu/integration/" + gateId.toString().substring(0, 8)
                + "/" + runId.toString().substring(0, 8);
        port.create(new GitIntegrationWorkspacePort.CreateRequest(
                runId, gateId, repository, baseCommit, target, branch, "owned-token"
        ));
        Files.writeString(target.resolve("tracked.txt"), "candidate\n");
        git.requireSuccess(target, List.of("add", "tracked.txt"));
        git.requireSuccess(target, List.of("commit", "-m", "integration candidate"), Map.of(
                "GIT_AUTHOR_NAME", "Zhishu Test",
                "GIT_AUTHOR_EMAIL", "zhishu-test@example.invalid",
                "GIT_COMMITTER_NAME", "Zhishu Test",
                "GIT_COMMITTER_EMAIL", "zhishu-test@example.invalid"
        ));
        String candidate = git.requireSuccess(target, List.of("rev-parse", "--verify", "HEAD^{commit}"))
                .stdout().trim();
        Files.writeString(repository.resolve("user-file.txt"), "do not touch\n");

        assertThatThrownBy(() -> port.fastForwardPrimary(new GitIntegrationWorkspacePort.FinalizeRequest(
                runId, repository, baseCommit, candidate, target, branch, "owned-token"
        ))).isInstanceOf(IOException.class).hasMessageContaining("must be clean");

        assertThat(git.requireSuccess(repository, List.of("rev-parse", "--verify", "HEAD^{commit}"))
                .stdout().trim()).isEqualTo(baseCommit);
        assertThat(Files.readString(repository.resolve("user-file.txt"))).isEqualTo("do not touch\n");
    }

    @Test
    void candidateCommitDoesNotRunARepositoryHook() throws Exception {
        Path hook = repository.resolve(".git").resolve("hooks").resolve("pre-commit");
        Files.writeString(hook, "#!/bin/sh\nexit 77\n");
        UUID runId = UUID.randomUUID();
        UUID gateId = UUID.randomUUID();
        Path target = provisioningRoot.resolve("integration").resolve("hook-run-" + runId);
        String branch = "zhishu/integration/" + gateId.toString().substring(0, 8)
                + "/" + runId.toString().substring(0, 8);

        port.create(new GitIntegrationWorkspacePort.CreateRequest(
                runId, gateId, repository, baseCommit, target, branch, "owned-token"
        ));
        Files.writeString(target.resolve("tracked.txt"), "candidate\n");
        assertThatCode(() -> {
            git.requireSuccess(target, List.of("add", "tracked.txt"));
            git.requireSuccess(target, List.of("commit", "-m", "hook regression"));
        }).doesNotThrowAnyException();
    }

    private void run(Path directory, List<String> command) throws Exception {
        ProcessBuilder builder = new ProcessBuilder(command).directory(directory.toFile());
        Map<String, String> environment = builder.environment();
        environment.put("GIT_AUTHOR_NAME", "Zhishu Test");
        environment.put("GIT_AUTHOR_EMAIL", "zhishu-test@example.invalid");
        environment.put("GIT_COMMITTER_NAME", "Zhishu Test");
        environment.put("GIT_COMMITTER_EMAIL", "zhishu-test@example.invalid");
        environment.put("GIT_TERMINAL_PROMPT", "0");
        Process process = builder.start();
        String stdout = new String(process.getInputStream().readAllBytes());
        String stderr = new String(process.getErrorStream().readAllBytes());
        if (!process.waitFor(30, java.util.concurrent.TimeUnit.SECONDS) || process.exitValue() != 0) {
            throw new IOException("Command failed: " + stdout + stderr);
        }
    }
}
