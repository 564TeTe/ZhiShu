package com.zhishu.workspace;

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

class GitWorktreeProvisioningPortTest {

    @TempDir
    Path temporaryRoot;

    private Path repository;
    private Path provisioningRoot;
    private GitCommandRunner git;
    private GitWorktreeProvisioningPort port;
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
        port = new GitWorktreeProvisioningPort(properties, git, new ObjectMapper());
        baseCommit = git.requireSuccess(repository, List.of("rev-parse", "--verify", "HEAD^{commit}"))
                .stdout().trim();
    }

    @Test
    void createsReplaysAndCleansOnlyTheOwnedWorktreeWithoutChangingMainState() throws Exception {
        UUID scheduleId = UUID.randomUUID();
        UUID leaseId = UUID.randomUUID();
        Path target = provisioningRoot.resolve("project").resolve("worker");
        String branch = "zhishu/ws/" + scheduleId.toString().substring(0, 8)
                + "/1-" + leaseId.toString().substring(0, 8);
        WorkspaceProvisioningPort.ProvisionRequest request = new WorkspaceProvisioningPort.ProvisionRequest(
                leaseId, scheduleId, UUID.randomUUID(), target, "owned-token",
                repository, baseCommit, branch
        );
        Files.writeString(repository.resolve("user-untracked.txt"), "preserve me\n");
        String mainBefore = git.requireSuccess(repository, List.of(
                "status", "--porcelain=v1", "--untracked-files=all"
        )).stdout();

        port.provision(request);
        port.provision(request);

        assertThat(Files.isRegularFile(target.resolve(".zhishu-workspace-lease.json"))).isTrue();
        assertThat(git.requireSuccess(target, List.of("rev-parse", "--verify", "HEAD^{commit}"))
                .stdout().trim()).isEqualTo(baseCommit);
        assertThat(git.requireSuccess(repository, List.of(
                "status", "--porcelain=v1", "--untracked-files=all"
        )).stdout()).isEqualTo(mainBefore);
        assertThatThrownBy(() -> port.cleanup(new WorkspaceProvisioningPort.CleanupRequest(
                target, "wrong-token", repository, branch
        ))).isInstanceOf(IOException.class).hasMessageContaining("does not match");

        port.cleanup(new WorkspaceProvisioningPort.CleanupRequest(
                target, "owned-token", repository, branch
        ));

        assertThat(Files.exists(target)).isFalse();
        assertThat(git.run(repository, List.of(
                "show-ref", "--verify", "--quiet", "refs/heads/" + branch
        )).exitCode()).isEqualTo(1);
        assertThat(Files.readString(repository.resolve("user-untracked.txt"))).isEqualTo("preserve me\n");
    }

    @Test
    void rejectsAnUnmanagedExistingBranchAndAnEscapingTarget() throws Exception {
        UUID scheduleId = UUID.randomUUID();
        UUID leaseId = UUID.randomUUID();
        String branch = "zhishu/ws/" + scheduleId.toString().substring(0, 8)
                + "/2-" + leaseId.toString().substring(0, 8);
        run(repository, List.of("git", "branch", branch, baseCommit));
        WorkspaceProvisioningPort.ProvisionRequest existingBranch = new WorkspaceProvisioningPort.ProvisionRequest(
                leaseId, scheduleId, UUID.randomUUID(), provisioningRoot.resolve("worker"), "token",
                repository, baseCommit, branch
        );
        assertThatThrownBy(() -> port.provision(existingBranch))
                .isInstanceOf(IOException.class).hasMessageContaining("already exists");

        WorkspaceProvisioningPort.ProvisionRequest escaping = new WorkspaceProvisioningPort.ProvisionRequest(
                UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), temporaryRoot.resolve("outside"), "token",
                repository, baseCommit, "zhishu/ws/12345678/1-12345678"
        );
        assertThatThrownBy(() -> port.provision(escaping))
                .isInstanceOf(IOException.class).hasMessageContaining("escapes");
    }

    @Test
    void controlledGitCommandsIgnoreARepositoryHook() throws Exception {
        Path hook = repository.resolve(".git").resolve("hooks").resolve("pre-commit");
        Files.writeString(hook, "#!/bin/sh\nexit 77\n");
        Path target = provisioningRoot.resolve("hook-test");
        WorkspaceProvisioningPort.ProvisionRequest request = new WorkspaceProvisioningPort.ProvisionRequest(
                UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), target, "owned-token",
                repository, baseCommit, "zhishu/ws/12345678/1-12345678"
        );

        port.provision(request);
        Files.writeString(target.resolve("hook-test.txt"), "controlled\n");
        assertThatCode(() -> {
            git.requireSuccess(target, List.of("add", "hook-test.txt"));
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
