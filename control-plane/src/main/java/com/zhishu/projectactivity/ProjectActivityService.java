package com.zhishu.projectactivity;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import com.zhishu.task.TaskNotFoundException;

@Service
public class ProjectActivityService {

    private static final int MAX_LIMIT = 200;
    private static final int MIN_WINDOW_HOURS = 1;
    private static final int MAX_WINDOW_HOURS = 24 * 90;

    private final JdbcTemplate jdbc;
    private final int retentionEvents;

    public ProjectActivityService(
            JdbcTemplate jdbc,
            @Value("${zhishu.project-activity.retention-events:10000}") int retentionEvents
    ) {
        this.jdbc = jdbc;
        this.retentionEvents = Math.max(1, retentionEvents);
    }

    public ProjectActivityFeed read(UUID projectId, Long afterCursor, int limit) {
        requireProject(projectId);
        if (limit < 1 || limit > MAX_LIMIT) {
            throw new IllegalArgumentException("Activity limit must be between 1 and " + MAX_LIMIT);
        }
        if (afterCursor != null && afterCursor < 0) {
            throw new IllegalArgumentException("Activity cursor must be non-negative");
        }

        Long latest = jdbc.queryForObject("""
                SELECT COALESCE(MAX(cursor), 0)
                FROM project_activity_event
                WHERE project_id = ?
                """, Long.class, projectId);
        long latestCursor = latest == null ? 0L : latest;
        long floorCursor = retentionFloor(projectId);

        if (afterCursor == null) {
            return new ProjectActivityFeed(
                    "1.0", projectId, "READY", null, latestCursor, floorCursor,
                    latestCursor, false, List.of()
            );
        }
        if (afterCursor > latestCursor || afterCursor < floorCursor) {
            return new ProjectActivityFeed(
                    "1.0", projectId, "RESYNC_REQUIRED", afterCursor, latestCursor, floorCursor,
                    latestCursor, false, List.of()
            );
        }

        List<ProjectActivityEvent> events = jdbc.query("""
                SELECT cursor, event_id, project_id, change_type, resource_type, resource_id,
                       task_id, attempt_id, source_event_id, occurred_at
                FROM project_activity_event
                WHERE project_id = ? AND cursor > ?
                ORDER BY cursor ASC
                LIMIT ?
                """, (row, rowNumber) -> new ProjectActivityEvent(
                row.getLong("cursor"),
                row.getObject("event_id", UUID.class),
                row.getObject("project_id", UUID.class),
                row.getString("change_type"),
                row.getString("resource_type"),
                row.getString("resource_id"),
                row.getObject("task_id", UUID.class),
                row.getObject("attempt_id", UUID.class),
                row.getString("source_event_id"),
                row.getTimestamp("occurred_at").toInstant()
        ), projectId, afterCursor, limit + 1);
        boolean hasMore = events.size() > limit;
        List<ProjectActivityEvent> bounded = hasMore ? events.subList(0, limit) : events;
        long nextCursor = bounded.isEmpty()
                ? afterCursor
                : bounded.get(bounded.size() - 1).cursor();
        return new ProjectActivityFeed(
                "1.0", projectId, "READY", afterCursor, latestCursor, floorCursor,
                nextCursor, hasMore, List.copyOf(bounded)
        );
    }

    public ProjectMetricsView metrics(UUID projectId, int windowHours) {
        requireProject(projectId);
        if (windowHours < MIN_WINDOW_HOURS || windowHours > MAX_WINDOW_HOURS) {
            throw new IllegalArgumentException("Metrics windowHours must be between "
                    + MIN_WINDOW_HOURS + " and " + MAX_WINDOW_HOURS);
        }
        Instant generatedAt = Instant.now();
        Instant since = generatedAt.minusSeconds(windowHours * 3600L);
        Timestamp sinceTimestamp = Timestamp.from(since);

        Map<String, Object> attempts = jdbc.queryForMap("""
                WITH project_attempts AS (
                    SELECT a.*, t.current_attempt_id, a.created_at >= ? AS in_window
                    FROM task_attempt a
                    JOIN agent_task t ON t.id = a.task_id
                    WHERE t.project_id = ?
                )
                SELECT COUNT(*) FILTER (WHERE a.in_window) AS total,
                       COUNT(*) FILTER (
                           WHERE a.in_window AND a.status IN ('SUCCEEDED', 'FAILED', 'LOST', 'ABORTED')
                       ) AS terminal,
                       COUNT(*) FILTER (WHERE a.in_window AND a.status = 'SUCCEEDED') AS succeeded,
                       COUNT(*) FILTER (WHERE a.in_window AND a.status = 'FAILED') AS failed,
                       COUNT(*) FILTER (WHERE a.in_window AND a.status = 'LOST') AS lost,
                       COUNT(*) FILTER (WHERE a.in_window AND a.status = 'ABORTED') AS aborted,
                       COUNT(*) FILTER (
                           WHERE a.status NOT IN ('SUCCEEDED', 'FAILED', 'LOST', 'ABORTED')
                             AND a.current_attempt_id = a.id
                       ) AS active,
                       COUNT(*) FILTER (
                           WHERE a.runtime_health_status = 'UNKNOWN' AND a.current_attempt_id = a.id
                       ) AS unknown_health,
                       COUNT(*) FILTER (
                           WHERE a.runtime_health_status = 'LOST' AND a.current_attempt_id = a.id
                       ) AS lost_health,
                       COALESCE(percentile_cont(0.50) WITHIN GROUP (
                           ORDER BY EXTRACT(EPOCH FROM (a.completed_at - a.started_at)) * 1000
                       ) FILTER (
                           WHERE a.in_window AND a.started_at IS NOT NULL AND a.completed_at IS NOT NULL
                       ), 0) AS p50_duration_ms,
                       COALESCE(percentile_cont(0.95) WITHIN GROUP (
                           ORDER BY EXTRACT(EPOCH FROM (a.completed_at - a.started_at)) * 1000
                       ) FILTER (
                           WHERE a.in_window AND a.started_at IS NOT NULL AND a.completed_at IS NOT NULL
                       ), 0) AS p95_duration_ms
                FROM project_attempts a
                """, sinceTimestamp, projectId);
        long terminal = number(attempts.get("terminal"));
        long failed = number(attempts.get("failed"));
        long lost = number(attempts.get("lost"));
        long aborted = number(attempts.get("aborted"));
        double failureRate = terminal == 0 ? 0D : (double) (failed + lost + aborted) / terminal;
        ProjectMetricsView.AttemptMetrics attemptMetrics = new ProjectMetricsView.AttemptMetrics(
                number(attempts.get("total")), terminal, number(attempts.get("succeeded")), failed,
                lost, aborted, number(attempts.get("active")), number(attempts.get("unknown_health")),
                number(attempts.get("lost_health")), failureRate,
                decimalLong(attempts.get("p50_duration_ms")), decimalLong(attempts.get("p95_duration_ms"))
        );

        Map<String, Object> tokens = jdbc.queryForMap("""
                SELECT COUNT(*) AS brain_runs,
                       COALESCE(SUM(input_tokens), 0) AS input_tokens,
                       COALESCE(SUM(output_tokens), 0) AS output_tokens
                FROM brain_run br
                JOIN brain_thread bt ON bt.id = br.thread_id
                WHERE bt.project_id = ? AND br.started_at >= ?
                """, projectId, sinceTimestamp);
        long inputTokens = number(tokens.get("input_tokens"));
        long outputTokens = number(tokens.get("output_tokens"));
        ProjectMetricsView.TokenMetrics tokenMetrics = new ProjectMetricsView.TokenMetrics(
                number(tokens.get("brain_runs")), inputTokens, outputTokens, inputTokens + outputTokens
        );

        Map<String, Object> activity = jdbc.queryForMap("""
                SELECT COUNT(*) AS event_count,
                       COALESCE(MAX(cursor), 0) AS latest_cursor,
                       MAX(occurred_at) AS latest_event_at
                FROM project_activity_event
                WHERE project_id = ? AND occurred_at >= ?
                """, projectId, sinceTimestamp);
        long eventCount = number(activity.get("event_count"));
        long latestCursor = number(activity.get("latest_cursor"));
        Instant latestEventAt = instant(activity.get("latest_event_at"));
        Long latestEventLagMs = latestEventAt == null
                ? null
                : Math.max(0L, generatedAt.toEpochMilli() - latestEventAt.toEpochMilli());
        ProjectMetricsView.ActivityMetrics activityMetrics = new ProjectMetricsView.ActivityMetrics(
                eventCount, latestCursor, retentionFloor(projectId), latestEventAt, latestEventLagMs
        );
        return new ProjectMetricsView("1.0", projectId, windowHours, generatedAt,
                attemptMetrics, tokenMetrics, activityMetrics);
    }

    private long retentionFloor(UUID projectId) {
        List<Long> boundary = jdbc.queryForList("""
                SELECT cursor FROM project_activity_event
                WHERE project_id = ? ORDER BY cursor DESC OFFSET ? LIMIT 2
                """, Long.class, projectId, retentionEvents - 1);
        return boundary.size() > 1 ? boundary.get(0) : 0L;
    }

    private void requireProject(UUID projectId) {
        Long count = jdbc.queryForObject("SELECT COUNT(*) FROM project WHERE id = ?", Long.class, projectId);
        if (count == null || count != 1L) {
            throw new TaskNotFoundException("Project was not found: " + projectId);
        }
    }

    private long number(Object value) {
        return value instanceof Number number ? number.longValue() : 0L;
    }

    private long decimalLong(Object value) {
        return value instanceof Number number ? Math.max(0L, Math.round(number.doubleValue())) : 0L;
    }

    private Instant instant(Object value) {
        if (value instanceof Timestamp timestamp) return timestamp.toInstant();
        if (value instanceof java.util.Date date) return date.toInstant();
        return null;
    }
}
