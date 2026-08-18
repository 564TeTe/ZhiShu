package com.zhishu.workspace;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;

import org.springframework.stereotype.Component;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

/** Creates and removes ownership-marked linked Worktrees without invoking a shell. */
@Component
public class GitWorktreeProvisioningPort implements WorkspaceProvisioningPort {

    private static final String MARKER = ".zhishu-workspace-lease.json";
    private static final String SIDECAR_SUFFIX = ".zhishu-worktree-lease.json";

    private final WorkspaceProvisionerProperties properties;
    private final GitCommandRunner git;
    private final ObjectMapper json;

    public GitWorktreeProvisioningPort(
            WorkspaceProvisionerProperties properties,
            GitCommandRunner git,
            ObjectMapper json
    ) {
        this.properties = properties;
        this.git = git;
        this.json = json;
    }

    @Override
    public String physicalWorkspaceKind() {
        return "GIT_WORKTREE";
    }

    @Override
    public ProvisionedWorkspace provision(ProvisionRequest request) throws IOException {
        Path repositoryRoot = requireRepositoryRoot(request.repositoryRoot());
        Path target = requireOwnedTarget(request.workspacePath());
        validateRequest(request);
        assertCommit(repositoryRoot, request.baseCommit());
        RepositoryState before = captureMainState(repositoryRoot);
        Path sidecar = sidecar(target);
        writeOrValidateMarker(sidecar, request);

        WorktreeEntry existing = findWorktree(repositoryRoot, target);
        if (existing != null) {
            validateExistingWorktree(existing, request);
            writeOrValidateMarker(target.resolve(MARKER), request);
            assertMainUnchanged(repositoryRoot, before);
            return new ProvisionedWorkspace(target);
        }
        if (Files.exists(target, LinkOption.NOFOLLOW_LINKS)) {
            if (Files.isSymbolicLink(target) || !isEmptyDirectory(target)) {
                throw new IOException("Worktree target already exists and is not an empty owned directory.");
            }
            Files.delete(target);
        }
        if (branchExists(repositoryRoot, request.branchRef())) {
            throw new IOException("Worktree branch already exists without this Lease's Worktree.");
        }

        git.requireSuccess(repositoryRoot, List.of(
                "worktree", "add", "-b", request.branchRef(), target.toString(), request.baseCommit()
        ));
        WorktreeEntry created = findWorktree(repositoryRoot, target);
        if (created == null) throw new IOException("Git did not register the created Worktree.");
        validateExistingWorktree(created, request);
        writeOrValidateMarker(target.resolve(MARKER), request);
        assertMainUnchanged(repositoryRoot, before);
        return new ProvisionedWorkspace(target);
    }

    @Override
    public void cleanup(CleanupRequest request) throws IOException {
        Path repositoryRoot = requireRepositoryRoot(request.repositoryRoot());
        Path target = requireOwnedTarget(request.workspacePath());
        String branch = requireBranch(request.branchRef());
        Path sidecar = sidecar(target);
        validateCleanupMarker(sidecar, target.resolve(MARKER), request.ownershipToken(), repositoryRoot, branch);
        RepositoryState before = captureMainState(repositoryRoot);
        WorktreeEntry existing = findWorktree(repositoryRoot, target);
        if (existing != null) {
            if (!branch.equals(existing.branch())) {
                throw new IOException("Registered Worktree branch does not match the Lease.");
            }
            // The ownership marker is intentionally untracked; force is safe only
            // after the marker, path, branch, and token checks above have passed.
            git.requireSuccess(repositoryRoot, List.of("worktree", "remove", "--force", target.toString()));
        } else if (Files.exists(target, LinkOption.NOFOLLOW_LINKS)) {
            if (Files.isSymbolicLink(target)) throw new IOException("Worktree target is a symbolic link.");
            validateMarker(target.resolve(MARKER), request.ownershipToken(), repositoryRoot, branch);
            deleteOwnedDirectory(target);
        }
        if (branchExists(repositoryRoot, branch)) {
            git.requireSuccess(repositoryRoot, List.of("branch", "-D", branch));
        }
        Files.deleteIfExists(sidecar);
        assertMainUnchanged(repositoryRoot, before);
    }

    private void validateRequest(ProvisionRequest request) throws IOException {
        requireBranch(request.branchRef());
        if (request.baseCommit() == null || !request.baseCommit().matches("[0-9a-f]{40,64}")) {
            throw new IOException("Worktree base commit must be a full lowercase object id.");
        }
        if (request.ownershipToken() == null || request.ownershipToken().isBlank()) {
            throw new IOException("Worktree ownership token is required.");
        }
    }

    private Path requireRepositoryRoot(Path value) throws IOException {
        if (value == null) throw new IOException("Worktree repository root is required.");
        Path normalized = value.toAbsolutePath().normalize();
        if (!Files.isDirectory(normalized, LinkOption.NOFOLLOW_LINKS) || Files.isSymbolicLink(normalized)) {
            throw new IOException("Worktree repository root is not a canonical directory.");
        }
        Path real = normalized.toRealPath();
        if (!real.equals(normalized)) throw new IOException("Worktree repository root resolves through a link.");
        Path topLevel = Path.of(git.requireSuccess(real, List.of("rev-parse", "--show-toplevel"))
                .stdout().trim()).toRealPath();
        if (!real.equals(topLevel)) throw new IOException("Workspace Binding is not the Git repository root.");
        return real;
    }

    private Path requireOwnedTarget(Path value) throws IOException {
        if (value == null) throw new IOException("Worktree target is required.");
        Path root = properties.root().toAbsolutePath().normalize();
        Path target = value.toAbsolutePath().normalize();
        if (target.equals(root) || !target.startsWith(root)) {
            throw new IOException("Worktree target escapes the configured provisioning root.");
        }
        if (Files.exists(root, LinkOption.NOFOLLOW_LINKS) && Files.isSymbolicLink(root)) {
            throw new IOException("Worktree provisioning root is a symbolic link.");
        }
        Path current = root;
        for (Path component : root.relativize(target)) {
            current = current.resolve(component);
            if (Files.exists(current, LinkOption.NOFOLLOW_LINKS) && Files.isSymbolicLink(current)) {
                throw new IOException("Worktree target contains a symbolic-link component.");
            }
        }
        Files.createDirectories(target.getParent());
        return target;
    }

    private void assertCommit(Path root, String expected) throws IOException {
        String resolved = git.requireSuccess(root, List.of("rev-parse", "--verify", expected + "^{commit}"))
                .stdout().trim().toLowerCase(java.util.Locale.ROOT);
        if (!expected.equals(resolved)) throw new IOException("Worktree base commit no longer resolves exactly.");
    }

    private RepositoryState captureMainState(Path root) throws IOException {
        String head = git.requireSuccess(root, List.of("rev-parse", "--verify", "HEAD^{commit}"))
                .stdout().trim();
        String status = git.requireSuccess(root, List.of(
                "status", "--porcelain=v1", "--untracked-files=all"
        )).stdout();
        return new RepositoryState(head, status);
    }

    private void assertMainUnchanged(Path root, RepositoryState before) throws IOException {
        RepositoryState after = captureMainState(root);
        if (!before.equals(after)) {
            throw new IOException("Main Worktree changed during the managed Git operation.");
        }
    }

    private WorktreeEntry findWorktree(Path root, Path expectedPath) throws IOException {
        List<WorktreeEntry> entries = parseWorktrees(git.requireSuccess(
                root, List.of("worktree", "list", "--porcelain")
        ).stdout());
        for (WorktreeEntry entry : entries) {
            Path path = Path.of(entry.path()).toAbsolutePath().normalize();
            if (path.equals(expectedPath)) return entry;
        }
        return null;
    }

    private List<WorktreeEntry> parseWorktrees(String output) {
        List<WorktreeEntry> result = new ArrayList<>();
        String path = null;
        String head = null;
        String branch = null;
        for (String line : output.split("\\R", -1)) {
            if (line.isBlank()) {
                if (path != null) result.add(new WorktreeEntry(path, head, normalizeBranch(branch)));
                path = null;
                head = null;
                branch = null;
            } else if (line.startsWith("worktree ")) path = line.substring(9);
            else if (line.startsWith("HEAD ")) head = line.substring(5);
            else if (line.startsWith("branch ")) branch = line.substring(7);
        }
        if (path != null) result.add(new WorktreeEntry(path, head, normalizeBranch(branch)));
        return result;
    }

    private String normalizeBranch(String value) {
        if (value == null) return null;
        return value.startsWith("refs/heads/") ? value.substring("refs/heads/".length()) : value;
    }

    private void validateExistingWorktree(WorktreeEntry entry, ProvisionRequest request) throws IOException {
        if (!request.branchRef().equals(entry.branch())) {
            throw new IOException("Registered Worktree branch does not match the Lease.");
        }
        if (!request.baseCommit().equals(entry.head())) {
            throw new IOException("Registered Worktree HEAD does not match the frozen base commit.");
        }
    }

    private boolean branchExists(Path root, String branch) throws IOException {
        GitCommandRunner.Result result = git.run(root, List.of(
                "show-ref", "--verify", "--quiet", "refs/heads/" + branch
        ));
        if (result.exitCode() == 0) return true;
        if (result.exitCode() == 1) return false;
        throw new IOException("Git show-ref failed with exit " + result.exitCode() + ".");
    }

    private String requireBranch(String value) throws IOException {
        if (value == null || !value.matches("zhishu/ws/[0-9a-f]{8}/[12]-[0-9a-f]{8}")) {
            throw new IOException("Worktree branch is outside the deterministic namespace.");
        }
        return value;
    }

    private Path sidecar(Path target) {
        return target.resolveSibling(target.getFileName() + SIDECAR_SUFFIX);
    }

    private void writeOrValidateMarker(Path marker, ProvisionRequest request) throws IOException {
        if (Files.exists(marker, LinkOption.NOFOLLOW_LINKS)) {
            validateMarker(marker, request);
            return;
        }
        if (marker.getParent() != null) Files.createDirectories(marker.getParent());
        Files.writeString(marker, markerJson(request), StandardCharsets.UTF_8,
                StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE);
    }

    private void validateMarker(Path marker, ProvisionRequest request) throws IOException {
        JsonNode value = readMarker(marker);
        if (!text(value, "schemaVersion", "1.0")
                || !text(value, "workspaceMode", "GIT_WORKTREE")
                || !text(value, "leaseId", request.leaseId().toString())
                || !text(value, "scheduleId", request.scheduleId().toString())
                || !text(value, "assignmentId", request.assignmentId().toString())
                || !text(value, "ownershipToken", request.ownershipToken())
                || !text(value, "repositoryRoot", request.repositoryRoot().toString())
                || !text(value, "baseCommit", request.baseCommit())
                || !text(value, "branchRef", request.branchRef())) {
            throw new IOException("Worktree ownership marker does not match this Lease.");
        }
    }

    private void validateCleanupMarker(
            Path sidecar,
            Path inner,
            String token,
            Path repositoryRoot,
            String branch
    ) throws IOException {
        if (Files.exists(sidecar, LinkOption.NOFOLLOW_LINKS)) {
            validateMarker(sidecar, token, repositoryRoot, branch);
            return;
        }
        validateMarker(inner, token, repositoryRoot, branch);
    }

    private void validateMarker(Path marker, String token, Path repositoryRoot, String branch) throws IOException {
        JsonNode value = readMarker(marker);
        if (!text(value, "workspaceMode", "GIT_WORKTREE")
                || !text(value, "ownershipToken", token)
                || !text(value, "repositoryRoot", repositoryRoot.toString())
                || !text(value, "branchRef", branch)) {
            throw new IOException("Worktree ownership token or repository metadata does not match.");
        }
    }

    private JsonNode readMarker(Path marker) throws IOException {
        if (!Files.isRegularFile(marker, LinkOption.NOFOLLOW_LINKS) || Files.isSymbolicLink(marker)) {
            throw new IOException("Worktree ownership marker is missing or unsafe.");
        }
        try {
            JsonNode value = json.readTree(Files.readString(marker, StandardCharsets.UTF_8));
            if (value == null || !value.isObject()) throw new IOException("Worktree ownership marker is invalid.");
            return value;
        } catch (JsonProcessingException error) {
            throw new IOException("Worktree ownership marker is unreadable.", error);
        }
    }

    private boolean text(JsonNode value, String field, String expected) {
        return value.path(field).isTextual() && expected.equals(value.path(field).textValue());
    }

    private String markerJson(ProvisionRequest request) throws IOException {
        ObjectNode marker = json.createObjectNode()
                .put("schemaVersion", "1.0")
                .put("workspaceMode", "GIT_WORKTREE")
                .put("leaseId", request.leaseId().toString())
                .put("scheduleId", request.scheduleId().toString())
                .put("assignmentId", request.assignmentId().toString())
                .put("ownershipToken", request.ownershipToken())
                .put("repositoryRoot", request.repositoryRoot().toString())
                .put("baseCommit", request.baseCommit())
                .put("branchRef", request.branchRef());
        try {
            return json.writeValueAsString(marker);
        } catch (JsonProcessingException error) {
            throw new IOException("Worktree ownership marker could not be serialized.", error);
        }
    }

    private boolean isEmptyDirectory(Path path) throws IOException {
        if (!Files.isDirectory(path, LinkOption.NOFOLLOW_LINKS)) return false;
        try (var entries = Files.list(path)) {
            return entries.findAny().isEmpty();
        }
    }

    private void deleteOwnedDirectory(Path target) throws IOException {
        try (var entries = Files.walk(target)) {
            for (Path entry : entries.sorted(Comparator.reverseOrder()).toList()) {
                Files.deleteIfExists(entry);
            }
        }
    }

    private record RepositoryState(String head, String status) {
    }

    private record WorktreeEntry(String path, String head, String branch) {
    }
}
