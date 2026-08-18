package com.zhishu.workspace;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import com.zhishu.state.ProjectStateConflictException;

/** Resolves a Project's server-owned primary repository and freezes its HEAD commit. */
@Service
public class GitRepositoryInspector {

    private final JdbcTemplate jdbc;
    private final GitCommandRunner git;

    public GitRepositoryInspector(JdbcTemplate jdbc, GitCommandRunner git) {
        this.jdbc = jdbc;
        this.git = git;
    }

    public Snapshot inspect(UUID projectId) {
        Path configured = configuredRoot(projectId);
        try {
            if (!Files.isDirectory(configured, LinkOption.NOFOLLOW_LINKS) || Files.isSymbolicLink(configured)) {
                throw new IOException("Primary Workspace Binding is not a canonical directory.");
            }
            Path realRoot = configured.toRealPath();
            if (!realRoot.equals(configured.toAbsolutePath().normalize())) {
                throw new IOException("Primary Workspace Binding resolves through a symbolic link or junction.");
            }
            String topLevel = git.requireSuccess(realRoot, List.of("rev-parse", "--show-toplevel"))
                    .stdout().trim();
            Path repositoryRoot = Path.of(topLevel).toRealPath();
            if (!repositoryRoot.equals(realRoot)) {
                throw new IOException("Primary Workspace Binding is not the Git repository root.");
            }
            String commit = git.requireSuccess(repositoryRoot, List.of("rev-parse", "--verify", "HEAD^{commit}"))
                    .stdout().trim().toLowerCase(java.util.Locale.ROOT);
            if (!commit.matches("[0-9a-f]{40,64}")) {
                throw new IOException("Git HEAD did not resolve to a full commit object.");
            }
            return new Snapshot(repositoryRoot, commit);
        } catch (IOException | RuntimeException error) {
            if (error instanceof ProjectStateConflictException conflict) throw conflict;
            throw new ProjectStateConflictException("Git Workspace validation failed: " + safeMessage(error));
        }
    }

    private Path configuredRoot(UUID projectId) {
        try {
            Map<String, Object> row = jdbc.queryForMap("""
                    SELECT COALESCE(binding.workspace_path, project.runtime_project_ref) AS workspace_path
                    FROM project
                    LEFT JOIN LATERAL (
                        SELECT workspace_path FROM workspace_binding
                        WHERE project_id = project.id AND status = 'ACTIVE' AND is_primary = TRUE
                        ORDER BY updated_at DESC LIMIT 1
                    ) binding ON TRUE
                    WHERE project.id = ? AND project.status = 'ACTIVE'
                    """, projectId);
            Object raw = row.get("workspace_path");
            String value = raw == null ? "" : String.valueOf(raw).trim();
            if (value.isEmpty()) throw new ProjectStateConflictException("Project has no primary Workspace Binding.");
            return Path.of(value).toAbsolutePath().normalize();
        } catch (EmptyResultDataAccessException error) {
            throw new ProjectStateConflictException("Project has no active primary Workspace Binding.");
        }
    }

    private String safeMessage(Throwable error) {
        String message = error.getMessage();
        return message == null || message.isBlank() ? error.getClass().getSimpleName() : message;
    }

    public record Snapshot(Path repositoryRoot, String baseCommit) {
    }
}
