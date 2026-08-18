package com.zhishu.workspace;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.Comparator;
import java.util.UUID;

import org.springframework.stereotype.Component;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * Creates and cleans a Control Plane-owned marked directory without invoking
 * Git, branches, or repository operations. Cleanup requires the exact marker
 * token and a path below the configured provisioning root.
 */
@Component
public class FilesystemWorkspaceProvisioningPort implements WorkspaceProvisioningPort {

    private static final String MARKER = ".zhishu-workspace-lease.json";

    private final WorkspaceProvisionerProperties properties;
    private final ObjectMapper json;

    public FilesystemWorkspaceProvisioningPort(WorkspaceProvisionerProperties properties, ObjectMapper json) {
        this.properties = properties;
        this.json = json;
    }

    @Override
    public String physicalWorkspaceKind() {
        return "DIRECTORY_ONLY";
    }

    @Override
    public ProvisionedWorkspace provision(ProvisionRequest request) throws IOException {
        Path path = requireOwnedChild(request.workspacePath());
        Files.createDirectories(properties.root());
        path = requireOwnedChild(request.workspacePath());
        Files.createDirectories(path);
        path = requireOwnedChild(request.workspacePath());
        ensureRealPathWithinRoot(path);
        Path marker = path.resolve(MARKER);
        String markerContent = writeMarker(request);
        if (Files.exists(marker, LinkOption.NOFOLLOW_LINKS)) {
            if (Files.isSymbolicLink(marker) || !markerMatches(marker, request)) {
                throw new IOException("Workspace path is already owned by a different Lease.");
            }
            return new ProvisionedWorkspace(path);
        }
        Files.writeString(
                marker, markerContent, StandardCharsets.UTF_8,
                StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE
        );
        return new ProvisionedWorkspace(path);
    }

    @Override
    public void cleanup(CleanupRequest request) throws IOException {
        Path path = requireOwnedChild(request.workspacePath());
        if (!Files.exists(path, LinkOption.NOFOLLOW_LINKS)) return;
        ensureRealPathWithinRoot(path);
        Path marker = path.resolve(MARKER);
        if (!Files.exists(marker, LinkOption.NOFOLLOW_LINKS)) {
            throw new IOException("Workspace ownership marker is missing; refusing cleanup.");
        }
        if (Files.isSymbolicLink(marker)) {
            throw new IOException("Workspace ownership marker is a symbolic link; refusing cleanup.");
        }
        JsonNode markerData;
        try {
            markerData = json.readTree(Files.readString(marker, StandardCharsets.UTF_8));
        } catch (JsonProcessingException error) {
            throw new IOException("Workspace ownership marker is unreadable; refusing cleanup.", error);
        }
        if (markerData == null || !markerData.isObject()
                || !request.ownershipToken().equals(markerData.path("ownershipToken").asText(null))) {
            throw new IOException("Workspace ownership token does not match; refusing cleanup.");
        }
        if (Files.isSymbolicLink(path)) {
            throw new IOException("Workspace path is a symbolic link; refusing cleanup.");
        }
        try (var entries = Files.walk(path)) {
            entries.sorted(Comparator.reverseOrder()).forEach(entry -> {
                try {
                    Files.deleteIfExists(entry);
                } catch (IOException error) {
                    throw new WorkspaceCleanupRuntimeException(error);
                }
            });
        } catch (WorkspaceCleanupRuntimeException error) {
            throw error.cause;
        }
    }

    private Path requireOwnedChild(Path path) throws IOException {
        if (path == null) throw new IOException("Workspace path is required.");
        Path root = properties.root().toAbsolutePath().normalize();
        Path normalized = path.toAbsolutePath().normalize();
        if (normalized.equals(root) || !normalized.startsWith(root)) {
            throw new IOException("Workspace path escapes the configured provisioning root.");
        }
        ensureNoSymlinkComponents(root, normalized);
        ensureExistingAncestorsStayWithinRoot(root, normalized);
        return normalized;
    }

    private void ensureNoSymlinkComponents(Path root, Path normalized) throws IOException {
        if (Files.exists(root, LinkOption.NOFOLLOW_LINKS) && Files.isSymbolicLink(root)) {
            throw new IOException("Workspace provisioning root is a symbolic link.");
        }
        Path current = root;
        for (Path component : root.relativize(normalized)) {
            current = current.resolve(component);
            if (Files.exists(current, LinkOption.NOFOLLOW_LINKS) && Files.isSymbolicLink(current)) {
                throw new IOException("Workspace path contains a symbolic-link component.");
            }
        }
    }

    private void ensureExistingAncestorsStayWithinRoot(Path root, Path normalized) throws IOException {
        if (!Files.exists(root, LinkOption.NOFOLLOW_LINKS)) return;
        Path rootReal = root.toRealPath();
        Path current = root;
        for (Path component : root.relativize(normalized)) {
            current = current.resolve(component);
            if (!Files.exists(current, LinkOption.NOFOLLOW_LINKS)) break;
            Path currentReal = current.toRealPath();
            if (!currentReal.startsWith(rootReal)) {
                throw new IOException("Workspace path contains a component outside the provisioning root.");
            }
        }
    }

    private void ensureRealPathWithinRoot(Path path) throws IOException {
        Path rootReal = properties.root().toRealPath();
        Path pathReal = path.toRealPath();
        if (pathReal.equals(rootReal) || !pathReal.startsWith(rootReal)) {
            throw new IOException("Workspace real path escapes the configured provisioning root.");
        }
    }

    private boolean markerMatches(Path marker, ProvisionRequest request) throws IOException {
        JsonNode markerData;
        try {
            markerData = json.readTree(Files.readString(marker, StandardCharsets.UTF_8));
        } catch (JsonProcessingException error) {
            throw new IOException("Workspace ownership marker is unreadable; refusing reuse.", error);
        }
        return markerData != null && markerData.isObject()
                && textEquals(markerData, "schemaVersion", "1.0")
                && textEquals(markerData, "leaseId", request.leaseId().toString())
                && textEquals(markerData, "scheduleId", request.scheduleId().toString())
                && textEquals(markerData, "assignmentId", request.assignmentId().toString())
                && textEquals(markerData, "ownershipToken", request.ownershipToken())
                && textEquals(markerData, "workspaceMode", "DIRECTORY_ONLY");
    }

    private boolean textEquals(JsonNode node, String field, String expected) {
        return node.path(field).isTextual() && expected.equals(node.path(field).textValue());
    }

    private String writeMarker(ProvisionRequest request) throws IOException {
        try {
            ObjectNode marker = json.createObjectNode()
                    .put("schemaVersion", "1.0")
                    .put("leaseId", request.leaseId().toString())
                    .put("scheduleId", request.scheduleId().toString())
                    .put("assignmentId", request.assignmentId().toString())
                    .put("ownershipToken", request.ownershipToken())
                    .put("workspaceMode", "DIRECTORY_ONLY");
            return json.writeValueAsString(marker);
        } catch (JsonProcessingException error) {
            throw new IOException("Workspace ownership marker could not be written.", error);
        }
    }

    private static final class WorkspaceCleanupRuntimeException extends RuntimeException {
        private final IOException cause;

        private WorkspaceCleanupRuntimeException(IOException cause) {
            this.cause = cause;
        }
    }
}
