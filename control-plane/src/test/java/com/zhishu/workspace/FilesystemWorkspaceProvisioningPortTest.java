package com.zhishu.workspace;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.io.TempDir;

import com.fasterxml.jackson.databind.ObjectMapper;

class FilesystemWorkspaceProvisioningPortTest {

    @TempDir
    Path root;

    @Test
    void provisionsIdempotentlyAndCleansOnlyWithTheMatchingOwnershipToken() throws Exception {
        FilesystemWorkspaceProvisioningPort port = new FilesystemWorkspaceProvisioningPort(
                new WorkspaceProvisionerProperties(root, Duration.ofMinutes(1), Duration.ofMinutes(5), Duration.ofSeconds(1)),
                new ObjectMapper()
        );
        Path workspace = root.resolve("project-1").resolve("schedule-1").resolve("worker-1");
        WorkspaceProvisioningPort.ProvisionRequest request = new WorkspaceProvisioningPort.ProvisionRequest(
                UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), workspace, "token-1"
        );

        port.provision(request);
        port.provision(request);

        assertThat(Files.exists(workspace.resolve(".zhishu-workspace-lease.json"))).isTrue();
        assertThatThrownBy(() -> port.cleanup(new WorkspaceProvisioningPort.CleanupRequest(workspace, "wrong")))
                .isInstanceOf(Exception.class)
                .hasMessageContaining("does not match");
        port.cleanup(new WorkspaceProvisioningPort.CleanupRequest(workspace, "token-1"));
        assertThat(Files.exists(workspace)).isFalse();
    }

    @Test
    void reusesMarkerWithEquivalentJsonRegardlessOfFieldOrder() throws Exception {
        FilesystemWorkspaceProvisioningPort port = new FilesystemWorkspaceProvisioningPort(
                new WorkspaceProvisionerProperties(root, Duration.ofMinutes(1), Duration.ofMinutes(5), Duration.ofSeconds(1)),
                new ObjectMapper()
        );
        UUID leaseId = UUID.randomUUID();
        UUID scheduleId = UUID.randomUUID();
        UUID assignmentId = UUID.randomUUID();
        Path workspace = root.resolve("project-1").resolve("schedule-1").resolve("worker-1");
        WorkspaceProvisioningPort.ProvisionRequest request = new WorkspaceProvisioningPort.ProvisionRequest(
                leaseId, scheduleId, assignmentId, workspace, "token-ordered"
        );

        port.provision(request);
        Files.writeString(workspace.resolve(".zhishu-workspace-lease.json"), """
                {"workspaceMode":"DIRECTORY_ONLY","ownershipToken":"token-ordered",
                 "assignmentId":"%s","scheduleId":"%s","schemaVersion":"1.0","leaseId":"%s"}
                """.formatted(assignmentId, scheduleId, leaseId));

        assertThatCode(() -> port.provision(request)).doesNotThrowAnyException();
    }

    @Test
    void refusesPathsOutsideTheConfiguredRoot() {
        FilesystemWorkspaceProvisioningPort port = new FilesystemWorkspaceProvisioningPort(
                new WorkspaceProvisionerProperties(root, Duration.ofMinutes(1), Duration.ofMinutes(5), Duration.ofSeconds(1)),
                new ObjectMapper()
        );
        WorkspaceProvisioningPort.ProvisionRequest request = new WorkspaceProvisioningPort.ProvisionRequest(
                UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                root.getParent().resolve("outside"), "token-2"
        );

        assertThatThrownBy(() -> port.provision(request))
                .isInstanceOf(Exception.class)
                .hasMessageContaining("escapes");
    }

    @Test
    void refusesSymlinkParentComponents() throws Exception {
        Path outside = Files.createTempDirectory("zhishu-workspace-outside-");
        Path symlink = root.resolve("project-link");
        try {
            Files.createSymbolicLink(symlink, outside);
        } catch (IOException | UnsupportedOperationException | SecurityException error) {
            Assumptions.assumeTrue(false, "symbolic links are unavailable in this test environment");
        }
        FilesystemWorkspaceProvisioningPort port = new FilesystemWorkspaceProvisioningPort(
                new WorkspaceProvisionerProperties(root, Duration.ofMinutes(1), Duration.ofMinutes(5), Duration.ofSeconds(1)),
                new ObjectMapper()
        );
        WorkspaceProvisioningPort.ProvisionRequest request = new WorkspaceProvisioningPort.ProvisionRequest(
                UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                symlink.resolve("schedule-1").resolve("worker-1"), "token-link"
        );

        assertThatThrownBy(() -> port.provision(request))
                .isInstanceOf(Exception.class)
                .hasMessageContaining("symbolic-link");
        assertThat(Files.exists(outside.resolve("schedule-1"))).isFalse();
    }
}
