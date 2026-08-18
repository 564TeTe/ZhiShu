package com.zhishu.brain;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.zhishu.state.ProjectStateConflictException;

@Service
public class BrainCollaborationService {

    private final JdbcTemplate jdbc;
    private final TransactionTemplate transactions;
    private final ObjectMapper json;

    public BrainCollaborationService(JdbcTemplate jdbc, TransactionTemplate transactions, ObjectMapper json) {
        this.jdbc = jdbc;
        this.transactions = transactions;
        this.json = json;
    }

    public Map<String, Object> createThread(UUID projectId, String title, String actor) {
        requireProject(projectId);
        UUID threadId = UUID.randomUUID();
        Instant now = Instant.now();
        jdbc.update("""
                INSERT INTO brain_thread (id, project_id, title, created_by, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """, threadId, projectId, requireText(title, "title"), requireText(actor, "actor"),
                Timestamp.from(now), Timestamp.from(now));
        return thread(threadId, projectId, title.trim(), "ACTIVE", actor.trim(), now, now);
    }

    public List<Map<String, Object>> listThreads(UUID projectId) {
        return jdbc.query("""
                SELECT id, project_id, title, status, created_by, created_at, updated_at
                FROM brain_thread WHERE project_id = ? ORDER BY updated_at DESC
                """, (row, number) -> thread(
                row.getObject("id", UUID.class), row.getObject("project_id", UUID.class),
                row.getString("title"), row.getString("status"), row.getString("created_by"),
                row.getTimestamp("created_at").toInstant(), row.getTimestamp("updated_at").toInstant()
        ), projectId);
    }

    public List<Map<String, Object>> listMessages(UUID projectId, UUID threadId) {
        requireThread(projectId, threadId);
        return jdbc.query("""
                SELECT id, thread_id, run_id, role, content, context_package_id,
                       citations::text AS citations, created_at
                FROM brain_message WHERE thread_id = ? ORDER BY created_at, id
                """, (row, number) -> {
            Map<String, Object> value = new LinkedHashMap<>();
            value.put("messageId", row.getObject("id", UUID.class));
            value.put("threadId", row.getObject("thread_id", UUID.class));
            value.put("runId", row.getObject("run_id", UUID.class));
            value.put("role", row.getString("role"));
            value.put("content", row.getString("content"));
            value.put("contextPackageId", row.getObject("context_package_id", UUID.class));
            value.put("citations", readJson(row.getString("citations")));
            value.put("createdAt", row.getTimestamp("created_at").toInstant());
            return value;
        }, threadId);
    }

    public Map<String, Object> recordRun(UUID projectId, UUID threadId, String actor, RunRecord command) {
        Map<String, Object> result = transactions.execute(status -> recordRunInTransaction(
                projectId, threadId, actor, command, null, null
        ));
        if (result == null) throw new IllegalStateException("Brain run transaction returned no result");
        return result;
    }

    /** Records one replay-safe Brain handoff for a durable upstream trigger. */
    public Map<String, Object> recordTriggeredRun(
            UUID projectId,
            UUID threadId,
            String actor,
            String triggerType,
            UUID triggerId,
            RunRecord command
    ) {
        Map<String, Object> result = transactions.execute(status -> {
            requireThread(projectId, threadId);
            jdbc.queryForObject("SELECT id FROM brain_thread WHERE id = ? FOR UPDATE", UUID.class, threadId);
            List<Map<String, Object>> existing = jdbc.query("""
                    SELECT r.id, r.thread_id, r.context_package_id, r.status,
                           m.content, m.citations::text AS citations, r.completed_at
                    FROM brain_run r JOIN brain_message m ON m.run_id = r.id AND m.role = 'BRAIN'
                    WHERE r.trigger_type = ? AND r.trigger_id = ?
                    """, (row, number) -> {
                Map<String, Object> value = new LinkedHashMap<>();
                value.put("runId", row.getObject("id", UUID.class));
                value.put("threadId", row.getObject("thread_id", UUID.class));
                value.put("contextPackageId", row.getObject("context_package_id", UUID.class));
                value.put("status", row.getString("status"));
                value.put("message", row.getString("content"));
                value.put("citations", readJson(row.getString("citations")));
                value.put("completedAt", row.getTimestamp("completed_at").toInstant());
                value.put("replayed", true);
                return value;
            }, requireText(triggerType, "triggerType"), triggerId);
            if (!existing.isEmpty()) return existing.get(0);
            Map<String, Object> created = recordRunInTransaction(
                    projectId, threadId, actor, command, triggerType.trim(), triggerId
            );
            created.put("replayed", false);
            return created;
        });
        if (result == null) throw new IllegalStateException("Triggered Brain run transaction returned no result");
        return result;
    }

    private Map<String, Object> recordRunInTransaction(
            UUID projectId,
            UUID threadId,
            String actor,
            RunRecord command,
            String triggerType,
            UUID triggerId
    ) {
        requireThread(projectId, threadId);
        Integer contextCount = jdbc.queryForObject("""
                SELECT count(*) FROM project_context_package_archive
                WHERE id = ? AND project_id = ? AND package_type = 'BRAIN'
                """, Integer.class, command.contextPackageId(), projectId);
        if (contextCount == null || contextCount != 1) {
            throw new ProjectStateConflictException("Brain Context Package does not belong to this project.");
        }
        UUID runId = UUID.randomUUID();
        UUID userMessageId = UUID.randomUUID();
        UUID brainMessageId = UUID.randomUUID();
        Instant now = Instant.now();
        String normalizedActor = requireText(actor, "actor");
        jdbc.update("""
                INSERT INTO brain_run (
                    id, thread_id, context_package_id, role_version, prompt_version,
                    output_schema_version, provider, model, permissions,
                    composite_context_version, status, input_tokens, output_tokens,
                    generated_proposal, trigger_type, trigger_id, started_at, completed_at
                ) VALUES (?, ?, ?, 'project-brain:v1', 'project-brain-prompt:v1',
                          'brain-answer:v1', ?, ?, CAST(? AS jsonb), CAST(? AS jsonb),
                          'SUCCEEDED', ?, ?, CAST(? AS jsonb), ?, ?, ?, ?)
                """, runId, threadId, command.contextPackageId(), requireText(command.provider(), "provider"),
                requireText(command.model(), "model"), write(command.permissions()),
                write(command.compositeContextVersion()), Math.max(0, command.inputTokens()),
                Math.max(0, command.outputTokens()), command.generatedProposal() == null
                        ? null : write(command.generatedProposal()), triggerType, triggerId,
                Timestamp.from(now), Timestamp.from(now));
        jdbc.update("""
                INSERT INTO brain_message (id, thread_id, run_id, role, content, context_package_id, citations, created_at)
                VALUES (?, ?, ?, 'USER', ?, ?, '[]'::jsonb, ?)
                """, userMessageId, threadId, runId, requireText(command.userMessage(), "userMessage"),
                command.contextPackageId(), Timestamp.from(now));
        jdbc.update("""
                INSERT INTO brain_message (id, thread_id, run_id, role, content, context_package_id, citations, created_at)
                VALUES (?, ?, ?, 'BRAIN', ?, ?, CAST(? AS jsonb), ?)
                """, brainMessageId, threadId, runId, requireText(command.brainMessage(), "brainMessage"),
                command.contextPackageId(), write(command.citations()), Timestamp.from(now.plusMillis(1)));
        jdbc.update("UPDATE brain_thread SET updated_at = ? WHERE id = ?", Timestamp.from(now), threadId);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("runId", runId);
        result.put("threadId", threadId);
        result.put("projectId", projectId);
        result.put("actor", normalizedActor);
        result.put("roleVersion", "project-brain:v1");
        result.put("promptVersion", "project-brain-prompt:v1");
        result.put("contextPackageId", command.contextPackageId());
        result.put("status", "SUCCEEDED");
        result.put("message", command.brainMessage().trim());
        result.put("citations", command.citations());
        result.put("generatedProposal", command.generatedProposal());
        result.put("completedAt", now);
        return result;
    }

    private void requireProject(UUID projectId) {
        Integer count = jdbc.queryForObject("SELECT count(*) FROM project WHERE id = ? AND status = 'ACTIVE'",
                Integer.class, projectId);
        if (count == null || count != 1) throw new ProjectStateConflictException("Project was not found.");
    }

    private void requireThread(UUID projectId, UUID threadId) {
        Integer count = jdbc.queryForObject("""
                SELECT count(*) FROM brain_thread WHERE id = ? AND project_id = ? AND status = 'ACTIVE'
                """, Integer.class, threadId, projectId);
        if (count == null || count != 1) throw new ProjectStateConflictException("Brain Thread was not found.");
    }

    private Map<String, Object> thread(
            UUID id, UUID projectId, String title, String status, String actor, Instant createdAt, Instant updatedAt
    ) {
        return Map.of(
                "threadId", id, "projectId", projectId, "title", title, "status", status,
                "createdBy", actor, "createdAt", createdAt, "updatedAt", updatedAt
        );
    }

    private String requireText(String value, String field) {
        if (value == null || value.isBlank()) throw new IllegalArgumentException(field + " is required");
        return value.trim();
    }

    private String write(Object value) {
        try {
            return json.writeValueAsString(value);
        } catch (JsonProcessingException error) {
            throw new IllegalArgumentException("Brain audit JSON serialization failed", error);
        }
    }

    private JsonNode readJson(String value) {
        try {
            return json.readTree(value);
        } catch (JsonProcessingException error) {
            throw new IllegalStateException("Brain audit JSON is unreadable", error);
        }
    }

    public record RunRecord(
            UUID contextPackageId,
            String provider,
            String model,
            JsonNode permissions,
            JsonNode compositeContextVersion,
            long inputTokens,
            long outputTokens,
            String userMessage,
            String brainMessage,
            JsonNode citations,
            JsonNode generatedProposal
    ) {
    }
}
