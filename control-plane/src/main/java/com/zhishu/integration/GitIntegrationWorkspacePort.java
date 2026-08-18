package com.zhishu.integration;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.List;
import java.util.UUID;

import org.springframework.stereotype.Component;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.zhishu.workspace.GitCommandRunner;
import com.zhishu.workspace.WorkspaceProvisionerProperties;

/** Owns the isolated Worktree used to combine Worker results; the primary Worktree is read-only. */
@Component
public class GitIntegrationWorkspacePort {

    private static final String MARKER = ".zhishu-integration-run.json";
    private static final String SIDECAR_SUFFIX = ".zhishu-integration-run.json";

    private final WorkspaceProvisionerProperties workspaces;
    private final GitCommandRunner git;
    private final ObjectMapper json;

    public GitIntegrationWorkspacePort(
            WorkspaceProvisionerProperties workspaces,
            GitCommandRunner git,
            ObjectMapper json
    ) {
        this.workspaces = workspaces;
        this.git = git;
        this.json = json;
    }

    public Path create(CreateRequest request) throws IOException {
        validate(request);
        Path repositoryRoot = request.repositoryRoot().toRealPath();
        Path target = ownedTarget(request.workspacePath());
        MainState before = mainState(repositoryRoot);
        Path sidecar = sidecar(target);
        writeOrValidate(sidecar, request);
        if (registered(repositoryRoot, target, request.branchRef(), request.baseCommit())) {
            writeOrValidate(target.resolve(MARKER), request);
            assertMainUnchanged(repositoryRoot, before);
            return target;
        }
        if (Files.exists(target, LinkOption.NOFOLLOW_LINKS)) {
            throw new IOException("Integration Worktree target already exists without matching Git metadata.");
        }
        if (branchExists(repositoryRoot, request.branchRef())) {
            throw new IOException("Integration branch already exists without its owned Worktree.");
        }
        try {
            git.requireSuccess(repositoryRoot, List.of(
                    "worktree", "add", "-b", request.branchRef(), target.toString(), request.baseCommit()
            ));
        } catch (IOException error) {
            throw new IOException("Git Integration Worktree creation failed for repository " + repositoryRoot
                    + ", target " + target + ", base " + request.baseCommit() + ": " + error.getMessage(), error);
        }
        if (!registered(repositoryRoot, target, request.branchRef(), request.baseCommit())) {
            throw new IOException("Git did not register the Integration Worktree exactly as requested.");
        }
        writeOrValidate(target.resolve(MARKER), request);
        assertMainUnchanged(repositoryRoot, before);
        return target;
    }

    public void cleanup(CleanupRequest request) throws IOException {
        Path repositoryRoot = request.repositoryRoot().toRealPath();
        Path target = ownedTarget(request.workspacePath());
        Path sidecar = sidecar(target);
        Path innerMarker = target.resolve(MARKER);
        if (!Files.exists(sidecar, LinkOption.NOFOLLOW_LINKS)
                && !Files.exists(innerMarker, LinkOption.NOFOLLOW_LINKS)) {
            if (registeredPath(repositoryRoot, target)
                    || Files.exists(target, LinkOption.NOFOLLOW_LINKS)
                    || branchExists(repositoryRoot, request.branchRef())) {
                throw new IOException("Integration ownership marker is missing before cleanup completed.");
            }
            return;
        }
        validateMarker(Files.exists(sidecar, LinkOption.NOFOLLOW_LINKS) ? sidecar : innerMarker,
                request.runId(), request.ownershipToken(), repositoryRoot, request.branchRef());
        MainState before = mainState(repositoryRoot);
        if (registeredPath(repositoryRoot, target)) {
            // The marker is deliberately untracked; force is bounded to the
            // already ownership-validated Integration Worktree path.
            git.requireSuccess(repositoryRoot, List.of("worktree", "remove", "--force", target.toString()));
        } else if (Files.exists(target, LinkOption.NOFOLLOW_LINKS)) {
            throw new IOException("Integration target exists without registered Worktree metadata.");
        }
        if (branchExists(repositoryRoot, request.branchRef())) {
            git.requireSuccess(repositoryRoot, List.of("branch", "-D", request.branchRef()));
        }
        Files.deleteIfExists(sidecar);
        assertMainUnchanged(repositoryRoot, before);
    }

    public FinalizationResult fastForwardPrimary(FinalizeRequest request) throws IOException {
        Path repositoryRoot = request.repositoryRoot().toRealPath();
        Path target = ownedTarget(request.workspacePath());
        if (request.candidateCommit() == null
                || !request.candidateCommit().matches("[0-9a-f]{40,64}")) {
            throw new IOException("Integration candidate commit must be a full lowercase object id.");
        }
        Path marker = Files.exists(sidecar(target), LinkOption.NOFOLLOW_LINKS)
                ? sidecar(target) : target.resolve(MARKER);
        validateMarker(marker, request.runId(), request.ownershipToken(), repositoryRoot, request.branchRef());
        if (!registered(repositoryRoot, target, request.branchRef(), request.candidateCommit())) {
            throw new IOException("Integration Worktree no longer points at the expected candidate commit.");
        }
        String candidate = git.requireSuccess(repositoryRoot, List.of(
                "rev-parse", "--verify", request.candidateCommit() + "^{commit}"
        )).stdout().trim();
        if (!request.candidateCommit().equals(candidate)) {
            throw new IOException("Integration candidate commit no longer resolves exactly.");
        }
        git.requireSuccess(repositoryRoot, List.of(
                "merge-base", "--is-ancestor", request.baseCommit(), request.candidateCommit()
        ));
        String targetRef = git.requireSuccess(repositoryRoot, List.of(
                "symbolic-ref", "--quiet", "--short", "HEAD"
        )).stdout().trim();
        if (targetRef.isBlank() || targetRef.startsWith("zhishu/integration/")) {
            throw new IOException("Primary Worktree HEAD is not attached to an eligible target branch.");
        }
        MainState before = mainState(repositoryRoot);
        if (!before.status().isBlank()) {
            throw new IOException("Primary Worktree must be clean before Integration finalization.");
        }
        if (request.candidateCommit().equals(before.head())) {
            return new FinalizationResult(targetRef, true);
        }
        if (!request.baseCommit().equals(before.head())) {
            throw new IOException("Primary Worktree HEAD moved after the Integration baseline was frozen.");
        }
        git.requireSuccess(repositoryRoot, List.of(
                "merge", "--ff-only", request.candidateCommit()
        ));
        MainState after = mainState(repositoryRoot);
        if (!request.candidateCommit().equals(after.head()) || !after.status().isBlank()) {
            throw new IOException("Primary Worktree did not reach the clean expected candidate commit.");
        }
        return new FinalizationResult(targetRef, false);
    }

    private void validate(CreateRequest request) throws IOException {
        if (request.repositoryRoot() == null || request.workspacePath() == null) {
            throw new IOException("Integration repository and target paths are required.");
        }
        Path configured = request.repositoryRoot().toAbsolutePath().normalize();
        if (!Files.isDirectory(configured, LinkOption.NOFOLLOW_LINKS) || Files.isSymbolicLink(configured)
                || !configured.equals(configured.toRealPath())) {
            throw new IOException("Integration repository root is not canonical.");
        }
        Path top = Path.of(git.requireSuccess(configured, List.of("rev-parse", "--show-toplevel"))
                .stdout().trim()).toRealPath();
        if (!top.equals(configured)) throw new IOException("Integration source is not the repository root.");
        String resolved = git.requireSuccess(configured, List.of(
                "rev-parse", "--verify", request.baseCommit() + "^{commit}"
        )).stdout().trim();
        if (!request.baseCommit().equals(resolved)) {
            throw new IOException("Integration base commit is not the frozen commit object.");
        }
        if (!request.branchRef().matches("zhishu/integration/[0-9a-f]{8}/[0-9a-f]{8}")) {
            throw new IOException("Integration branch is outside the deterministic namespace.");
        }
    }

    private Path ownedTarget(Path value) throws IOException {
        Path root = workspaces.root().toAbsolutePath().normalize();
        Path target = value.toAbsolutePath().normalize();
        if (target.equals(root) || !target.startsWith(root)) {
            throw new IOException("Integration Worktree escapes the provisioning root.");
        }
        Path current = root;
        if (Files.exists(root, LinkOption.NOFOLLOW_LINKS) && Files.isSymbolicLink(root)) {
            throw new IOException("Integration provisioning root is a symbolic link.");
        }
        for (Path component : root.relativize(target)) {
            current = current.resolve(component);
            if (Files.exists(current, LinkOption.NOFOLLOW_LINKS) && Files.isSymbolicLink(current)) {
                throw new IOException("Integration target contains a symbolic-link component.");
            }
        }
        Files.createDirectories(target.getParent());
        return target;
    }

    private boolean registered(Path root, Path target, String branch, String commit) throws IOException {
        String output = git.requireSuccess(root, List.of("worktree", "list", "--porcelain")).stdout();
        String currentPath = null;
        String currentHead = null;
        String currentBranch = null;
        for (String line : (output + System.lineSeparator()).split("\\R", -1)) {
            if (line.isBlank()) {
                if (currentPath != null && Path.of(currentPath).toAbsolutePath().normalize().equals(target)) {
                    String normalizedBranch = currentBranch != null && currentBranch.startsWith("refs/heads/")
                            ? currentBranch.substring("refs/heads/".length()) : currentBranch;
                    return branch.equals(normalizedBranch) && commit.equals(currentHead);
                }
                currentPath = null;
                currentHead = null;
                currentBranch = null;
            } else if (line.startsWith("worktree ")) currentPath = line.substring(9);
            else if (line.startsWith("HEAD ")) currentHead = line.substring(5);
            else if (line.startsWith("branch ")) currentBranch = line.substring(7);
        }
        return false;
    }

    private boolean registeredPath(Path root, Path target) throws IOException {
        String output = git.requireSuccess(root, List.of("worktree", "list", "--porcelain")).stdout();
        return output.lines().filter(line -> line.startsWith("worktree "))
                .map(line -> Path.of(line.substring(9)).toAbsolutePath().normalize())
                .anyMatch(target::equals);
    }

    private boolean branchExists(Path root, String branch) throws IOException {
        GitCommandRunner.Result result = git.run(root, List.of(
                "show-ref", "--verify", "--quiet", "refs/heads/" + branch
        ));
        if (result.exitCode() == 0) return true;
        if (result.exitCode() == 1) return false;
        throw new IOException("Git show-ref failed with exit " + result.exitCode() + ".");
    }

    private MainState mainState(Path root) throws IOException {
        return new MainState(
                git.requireSuccess(root, List.of("rev-parse", "--verify", "HEAD^{commit}"))
                        .stdout().trim(),
                git.requireSuccess(root, List.of("status", "--porcelain=v1", "--untracked-files=all"))
                        .stdout()
        );
    }

    private void assertMainUnchanged(Path root, MainState before) throws IOException {
        if (!before.equals(mainState(root))) {
            throw new IOException("Primary Worktree changed during Integration workspace preparation.");
        }
    }

    private Path sidecar(Path target) {
        return target.resolveSibling(target.getFileName() + SIDECAR_SUFFIX);
    }

    private void writeOrValidate(Path marker, CreateRequest request) throws IOException {
        if (Files.exists(marker, LinkOption.NOFOLLOW_LINKS)) {
            validateMarker(marker, request.runId(), request.ownershipToken(),
                    request.repositoryRoot(), request.branchRef());
            return;
        }
        ObjectNode value = json.createObjectNode()
                .put("schemaVersion", "1.0")
                .put("runId", request.runId().toString())
                .put("gateId", request.gateId().toString())
                .put("ownershipToken", request.ownershipToken())
                .put("repositoryRoot", request.repositoryRoot().toString())
                .put("baseCommit", request.baseCommit())
                .put("branchRef", request.branchRef());
        Files.writeString(marker, json.writeValueAsString(value), StandardCharsets.UTF_8,
                StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE);
    }

    private void validateMarker(
            Path marker,
            UUID runId,
            String ownershipToken,
            Path repositoryRoot,
            String branch
    ) throws IOException {
        if (!Files.isRegularFile(marker, LinkOption.NOFOLLOW_LINKS) || Files.isSymbolicLink(marker)) {
            throw new IOException("Integration ownership marker is missing or unsafe.");
        }
        JsonNode value = json.readTree(Files.readString(marker, StandardCharsets.UTF_8));
        if (!runId.toString().equals(value.path("runId").asText())
                || !ownershipToken.equals(value.path("ownershipToken").asText())
                || !repositoryRoot.toString().equals(value.path("repositoryRoot").asText())
                || !branch.equals(value.path("branchRef").asText())) {
            throw new IOException("Integration ownership marker does not match this Run.");
        }
    }

    public record CreateRequest(
            UUID runId,
            UUID gateId,
            Path repositoryRoot,
            String baseCommit,
            Path workspacePath,
            String branchRef,
            String ownershipToken
    ) {
    }

    public record CleanupRequest(
            UUID runId,
            Path repositoryRoot,
            Path workspacePath,
            String branchRef,
            String ownershipToken
    ) {
    }

    public record FinalizeRequest(
            UUID runId,
            Path repositoryRoot,
            String baseCommit,
            String candidateCommit,
            Path workspacePath,
            String branchRef,
            String ownershipToken
    ) {
    }

    public record FinalizationResult(String targetRef, boolean replayed) {
    }

    private record MainState(String head, String status) {
    }
}
