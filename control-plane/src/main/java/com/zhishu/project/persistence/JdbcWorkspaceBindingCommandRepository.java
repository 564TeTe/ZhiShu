package com.zhishu.project.persistence;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.Optional;

import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.support.TransactionTemplate;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.zhishu.project.ProjectIdentityConflictException;
import com.zhishu.project.WorkspaceBindingChangeView;
import com.zhishu.project.WorkspaceBindingCommand;
import com.zhishu.project.WorkspaceBindingCommandRepository;
import com.zhishu.project.WorkspaceBindingView;

@Repository
public class JdbcWorkspaceBindingCommandRepository implements WorkspaceBindingCommandRepository {

    private final JdbcTemplate jdbc;
    private final TransactionTemplate transactions;
    private final ObjectMapper json;

    public JdbcWorkspaceBindingCommandRepository(
            JdbcTemplate jdbc,
            TransactionTemplate transactions,
            ObjectMapper json
    ) {
        this.jdbc = jdbc;
        this.transactions = transactions;
        this.json = json;
    }

    @Override
    public WorkspaceBindingChangeView apply(WorkspaceBindingCommand command) {
        WorkspaceBindingChangeView result = transactions.execute(status -> applyInTransaction(command));
        if (result == null) throw new IllegalStateException("Workspace binding transaction returned no result");
        return result;
    }

    private WorkspaceBindingChangeView applyInTransaction(WorkspaceBindingCommand command) {
        WorkspaceBindingChangeView replay = findReplay(command.actor(), command.clientRequestId(), command.requestHash())
                .orElse(null);
        if (replay != null) return replay;

        Long version;
        try {
            version = jdbc.queryForObject(
                    "SELECT identity_version FROM project WHERE id = ? AND status = 'ACTIVE' FOR UPDATE",
                    Long.class,
                    command.projectId()
            );
        } catch (EmptyResultDataAccessException error) {
            throw new ProjectIdentityConflictException("The target project is missing or archived.");
        }
        if (version == null || version != command.baseIdentityVersion()) {
            throw new ProjectIdentityConflictException("Project identityVersion changed before confirmation.");
        }

        WorkspaceBindingView before = findBindingForUpdate(command.workspaceId());
        if (!before.projectId().equals(command.projectId()) || !"ACTIVE".equals(before.status())) {
            throw new ProjectIdentityConflictException("The source workspace binding is no longer active.");
        }

        WorkspaceBindingView after = switch (command.action()) {
            case "MOVE_WORKSPACE" -> move(command, before);
            case "REBIND_LOCAL_PROJECT" -> rebind(command, before);
            default -> throw new IllegalArgumentException("Unsupported workspace binding action: " + command.action());
        };
        int updated = jdbc.update(
                "UPDATE project SET identity_version = identity_version + 1, updated_at = now() WHERE id = ? AND identity_version = ?",
                command.projectId(), command.baseIdentityVersion()
        );
        if (updated != 1) throw new ProjectIdentityConflictException("Project identityVersion changed before commit.");

        UUID changeId = UUID.randomUUID();
        Instant createdAt = Instant.now();
        jdbc.update("""
                INSERT INTO workspace_binding_change (
                    id, proposal_id, project_id, workspace_id, resulting_workspace_id,
                    action, actor, client_request_id, request_hash,
                    base_identity_version, resulting_identity_version,
                    before_snapshot, after_snapshot, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS jsonb), CAST(? AS jsonb), ?)
                """,
                changeId, command.proposalId(), command.projectId(), before.workspaceId(), after.workspaceId(),
                command.action(), command.actor(), command.clientRequestId(), command.requestHash(),
                command.baseIdentityVersion(), command.baseIdentityVersion() + 1,
                snapshot(before), snapshot(after), Timestamp.from(createdAt)
        );
        return new WorkspaceBindingChangeView(
                changeId, command.proposalId(), command.action(), command.actor(), command.clientRequestId(),
                command.baseIdentityVersion(), command.baseIdentityVersion() + 1, after, createdAt
        );
    }

    private WorkspaceBindingView move(WorkspaceBindingCommand command, WorkspaceBindingView before) {
        if (!command.machineId().equals(before.machineId())
                || command.localProjectId() == null
                || !command.localProjectId().equals(before.localProjectId())) {
            throw new ProjectIdentityConflictException("MOVE_WORKSPACE requires the existing machine/local project binding.");
        }
        Integer conflicts = jdbc.queryForObject("""
                SELECT count(*) FROM workspace_binding
                WHERE machine_id = ? AND normalized_workspace_path = ? AND id <> ?
                """, Integer.class, command.machineId(), command.normalizedWorkspacePath(), before.workspaceId());
        if (conflicts != null && conflicts > 0) {
            throw new ProjectIdentityConflictException("The destination path is already bound on this machine.");
        }

        jdbc.update("""
                UPDATE workspace_binding
                SET local_project_id = NULL, is_primary = FALSE, status = 'MOVED', updated_at = now()
                WHERE id = ? AND status = 'ACTIVE'
                """, before.workspaceId());
        UUID workspaceId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO workspace_binding (
                    id, project_id, machine_id, local_project_id, workspace_path,
                    normalized_workspace_path, repository_url, remote_fingerprint, branch,
                    is_primary, status, last_seen_at, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', now(), now(), now())
                """,
                workspaceId, command.projectId(), command.machineId(), command.localProjectId(),
                command.workspacePath(), command.normalizedWorkspacePath(), before.repositoryUrl(),
                before.remoteFingerprint(), before.branch(), before.isPrimary()
        );
        return findBinding(workspaceId);
    }

    private WorkspaceBindingView rebind(WorkspaceBindingCommand command, WorkspaceBindingView before) {
        if (!command.normalizedWorkspacePath().equals(before.normalizedWorkspacePath())
                || command.localProjectId() == null) {
            throw new ProjectIdentityConflictException("REBIND_LOCAL_PROJECT requires the existing workspace path and a local id.");
        }
        Integer conflicts = jdbc.queryForObject("""
                SELECT count(*) FROM workspace_binding
                WHERE id <> ? AND (
                    (machine_id = ? AND normalized_workspace_path = ?)
                    OR (machine_id = ? AND local_project_id = ?)
                )
                """, Integer.class, before.workspaceId(), command.machineId(), command.normalizedWorkspacePath(),
                command.machineId(), command.localProjectId());
        if (conflicts != null && conflicts > 0) {
            throw new ProjectIdentityConflictException("The machine path or local project id is already bound.");
        }
        jdbc.update("""
                UPDATE workspace_binding
                SET machine_id = ?, local_project_id = ?, workspace_path = ?,
                    normalized_workspace_path = ?, last_seen_at = now(), updated_at = now()
                WHERE id = ? AND status = 'ACTIVE'
                """, command.machineId(), command.localProjectId(), command.workspacePath(),
                command.normalizedWorkspacePath(), before.workspaceId());
        return findBinding(before.workspaceId());
    }

    @Override
    public Optional<WorkspaceBindingChangeView> findReplay(
            String actor,
            String clientRequestId,
            String requestHash
    ) {
        try {
            Map<String, Object> row = jdbc.queryForMap("""
                    SELECT id, proposal_id, action, actor, client_request_id, request_hash,
                           base_identity_version, resulting_identity_version,
                           resulting_workspace_id, created_at
                    FROM workspace_binding_change
                    WHERE actor = ? AND client_request_id = ?
                    """, actor, clientRequestId);
            if (!requestHash.equals(row.get("request_hash"))) {
                throw new ProjectIdentityConflictException("clientRequestId was reused with different content.");
            }
            UUID resultingWorkspaceId = (UUID) row.get("resulting_workspace_id");
            return Optional.of(new WorkspaceBindingChangeView(
                    (UUID) row.get("id"),
                    (UUID) row.get("proposal_id"),
                    (String) row.get("action"),
                    (String) row.get("actor"),
                    (String) row.get("client_request_id"),
                    ((Number) row.get("base_identity_version")).longValue(),
                    ((Number) row.get("resulting_identity_version")).longValue(),
                    findBinding(resultingWorkspaceId),
                    ((Timestamp) row.get("created_at")).toInstant()
            ));
        } catch (EmptyResultDataAccessException error) {
            return Optional.empty();
        }
    }

    private WorkspaceBindingView findBindingForUpdate(UUID workspaceId) {
        try {
            return jdbc.queryForObject(BINDING_SELECT + " WHERE id = ? FOR UPDATE", this::mapBinding, workspaceId);
        } catch (EmptyResultDataAccessException error) {
            throw new ProjectIdentityConflictException("Workspace binding was not found.");
        }
    }

    private WorkspaceBindingView findBinding(UUID workspaceId) {
        try {
            return jdbc.queryForObject(BINDING_SELECT + " WHERE id = ?", this::mapBinding, workspaceId);
        } catch (EmptyResultDataAccessException error) {
            throw new ProjectIdentityConflictException("Workspace binding was not found.");
        }
    }

    private WorkspaceBindingView mapBinding(java.sql.ResultSet row, int rowNumber) throws java.sql.SQLException {
        return new WorkspaceBindingView(
                row.getObject("id", UUID.class),
                row.getObject("project_id", UUID.class),
                row.getString("machine_id"),
                row.getString("local_project_id"),
                row.getString("workspace_path"),
                row.getString("normalized_workspace_path"),
                row.getString("repository_url"),
                row.getString("remote_fingerprint"),
                row.getString("branch"),
                row.getBoolean("is_primary"),
                row.getString("status"),
                row.getTimestamp("last_seen_at").toInstant()
        );
    }

    private String snapshot(WorkspaceBindingView binding) {
        Map<String, Object> value = new LinkedHashMap<>();
        value.put("workspaceId", binding.workspaceId());
        value.put("projectId", binding.projectId());
        value.put("machineId", binding.machineId());
        value.put("localProjectId", binding.localProjectId());
        value.put("workspacePath", binding.workspacePath());
        value.put("normalizedWorkspacePath", binding.normalizedWorkspacePath());
        value.put("status", binding.status());
        value.put("isPrimary", binding.isPrimary());
        try {
            return json.writeValueAsString(value);
        } catch (JsonProcessingException error) {
            throw new IllegalStateException("Workspace binding audit serialization failed", error);
        }
    }

    private static final String BINDING_SELECT = """
            SELECT id, project_id, machine_id, local_project_id, workspace_path,
                   normalized_workspace_path, repository_url, remote_fingerprint, branch,
                   is_primary, status, last_seen_at
            FROM workspace_binding
            """;
}
