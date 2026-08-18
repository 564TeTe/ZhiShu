package com.zhishu.task.persistence;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import com.zhishu.task.TaskView;

@Mapper
interface TaskMapper {

    String TASK_VIEW_COLUMNS = """
            SELECT t.id AS taskId,
                   t.project_id AS projectId,
                   t.profile_id AS profileId,
                   t.title AS title,
                   t.objective AS objective,
                   t.status AS status,
                   t.resolution_status AS resolutionStatus,
                   a.id AS attemptId,
                   a.attempt_number AS attemptNumber,
                   a.runtime_run_id AS runtimeRunId,
                   a.runtime_health_status AS runtimeHealthStatus,
                   a.last_heartbeat_at AS lastHeartbeatAt,
                   a.lease_expires_at AS leaseExpiresAt,
                   a.unknown_since AS unknownSince,
                   a.lost_at AS lostAt,
                   a.lost_reason AS lostReason,
                   t.created_at AS createdAt,
                   a.started_at AS startedAt,
                   a.completed_at AS completedAt,
                   a.error_code AS errorCode,
                   a.error_message AS errorMessage,
                   t.archived_at AS archivedAt,
                   t.archived_by AS archivedBy,
                   t.archive_reason AS archiveReason
            FROM agent_task t
            LEFT JOIN task_attempt a ON a.id = t.current_attempt_id
            """;

    @Insert("""
            INSERT INTO agent_task (
                id, project_id, profile_id, title, objective, status, resolution_status,
                current_attempt_id, created_at, updated_at
            ) VALUES (
                #{id}, #{projectId}, #{profileId}, #{title}, #{objective}, #{status}, #{resolutionStatus},
                NULL, #{createdAt}, #{createdAt}
            )
            """)
    int insert(
            @Param("id") UUID id,
            @Param("projectId") UUID projectId,
            @Param("profileId") UUID profileId,
            @Param("title") String title,
            @Param("objective") String objective,
            @Param("status") String status,
            @Param("resolutionStatus") String resolutionStatus,
            @Param("createdAt") Instant createdAt
    );

    @Update("""
            UPDATE agent_task
            SET current_attempt_id = #{attemptId},
                status = #{status},
                resolution_status = CASE
                    WHEN #{status} IN ('SUCCEEDED') THEN 'WAITING_ACCEPTANCE'
                    WHEN #{status} IN ('FAILED', 'LOST', 'ABORTED') THEN 'NEEDS_FOLLOW_UP'
                    ELSE 'IN_PROGRESS'
                END,
                resolution_version = resolution_version + 1,
                updated_at = now()
            WHERE id = #{taskId}
            """)
    int attachAttempt(
            @Param("taskId") UUID taskId,
            @Param("attemptId") UUID attemptId,
            @Param("status") String status
    );

    @Update("""
            UPDATE agent_task
            SET status = #{status},
                resolution_status = CASE
                    WHEN #{status} IN ('SUCCEEDED') THEN 'WAITING_ACCEPTANCE'
                    WHEN #{status} IN ('FAILED', 'LOST', 'ABORTED') THEN 'NEEDS_FOLLOW_UP'
                    ELSE 'IN_PROGRESS'
                END,
                resolution_version = resolution_version + 1,
                updated_at = now()
            WHERE id = #{taskId}
              AND current_attempt_id = #{attemptId}
            """)
    int updateStatusForAttempt(
            @Param("taskId") UUID taskId,
            @Param("attemptId") UUID attemptId,
            @Param("status") String status
    );

    @Update("""
            UPDATE agent_task
            SET status = 'PENDING',
                resolution_status = 'IN_PROGRESS',
                resolution_version = resolution_version + 1,
                updated_at = now()
            WHERE id = #{taskId}
              AND current_attempt_id = #{parentAttemptId}
              AND status IN ('SUCCEEDED', 'FAILED', 'LOST', 'ABORTED')
              AND resolution_status IN ('WAITING_ACCEPTANCE', 'NEEDS_FOLLOW_UP')
            """)
    int claimFollowUp(@Param("taskId") UUID taskId, @Param("parentAttemptId") UUID parentAttemptId);

    @Update("""
            UPDATE agent_task
            SET archived_at = now(),
                archived_by = #{actor},
                archive_reason = #{reason},
                updated_at = now()
            WHERE id = #{taskId}
              AND status IN ('SUCCEEDED', 'FAILED', 'LOST', 'ABORTED')
              AND archived_at IS NULL
            """)
    int archiveIfTerminal(
            @Param("taskId") UUID taskId,
            @Param("actor") String actor,
            @Param("reason") String reason
    );

    @Select(TASK_VIEW_COLUMNS + " WHERE t.id = #{taskId} AND t.archived_at IS NULL")
    TaskView findById(@Param("taskId") UUID taskId);

    @Select(TASK_VIEW_COLUMNS + " WHERE t.id = #{taskId}")
    TaskView findIncludingArchivedById(@Param("taskId") UUID taskId);

    @Select(TASK_VIEW_COLUMNS + " WHERE t.project_id = #{projectId} AND t.id = #{taskId}")
    TaskView findByProjectAndId(@Param("projectId") UUID projectId, @Param("taskId") UUID taskId);

    @Select("""
            <script>
            """ + TASK_VIEW_COLUMNS + """
            <where>
              t.archived_at IS NULL
              <if test="projectId != null">AND t.project_id = #{projectId}</if>
            </where>
            ORDER BY t.created_at DESC
            LIMIT #{limit}
            </script>
            """)
    List<TaskView> list(@Param("projectId") UUID projectId, @Param("limit") int limit);

    @Select("""
            <script>
            """ + TASK_VIEW_COLUMNS + """
            WHERE t.project_id = #{projectId}
              AND (
                #{archiveScope} = 'ALL'
                OR (#{archiveScope} = 'ACTIVE' AND t.archived_at IS NULL)
                OR (#{archiveScope} = 'ARCHIVED' AND t.archived_at IS NOT NULL)
              )
              <if test="status != null">AND t.status = #{status}</if>
              <if test="resolutionStatus != null">AND t.resolution_status = #{resolutionStatus}</if>
              <if test="searchPattern != null">
                AND (
                  lower(t.title) LIKE #{searchPattern} ESCAPE '!'
                  OR lower(t.objective) LIKE #{searchPattern} ESCAPE '!'
                  OR CAST(t.id AS text) LIKE #{searchPattern} ESCAPE '!'
                )
              </if>
              <if test="beforeCreatedAt != null">
                AND (
                  t.created_at &lt; #{beforeCreatedAt}
                  OR (t.created_at = #{beforeCreatedAt} AND t.id &lt; #{beforeTaskId})
                )
              </if>
            ORDER BY t.created_at DESC, t.id DESC
            LIMIT #{limit}
            </script>
            """)
    List<TaskView> search(
            @Param("projectId") UUID projectId,
            @Param("archiveScope") String archiveScope,
            @Param("status") String status,
            @Param("resolutionStatus") String resolutionStatus,
            @Param("searchPattern") String searchPattern,
            @Param("beforeCreatedAt") Instant beforeCreatedAt,
            @Param("beforeTaskId") UUID beforeTaskId,
            @Param("limit") int limit
    );

    @Select("""
            SELECT ta.id AS attemptId,
                   ta.attempt_number AS attemptNumber,
                   ta.runtime_run_id AS runtimeRunId,
                   ta.status AS status,
                   ta.runtime_health_status AS runtimeHealthStatus,
                   ta.last_heartbeat_at AS lastHeartbeatAt,
                   ta.lease_expires_at AS leaseExpiresAt,
                   ta.unknown_since AS unknownSince,
                   ta.lost_at AS lostAt,
                   ta.lost_reason AS lostReason,
                   ta.profile_snapshot ->> 'executor' AS executor,
                   ta.profile_snapshot ->> 'modelAlias' AS modelAlias,
                   ta.profile_snapshot ->> 'connectionRef' AS connectionRef,
                   ta.approval_policy_snapshot ->> 'mode' AS approvalMode,
                   COALESCE(
                       ta.approval_policy_snapshot ->> 'requestedMode',
                       ta.approval_policy_snapshot ->> 'mode'
                   ) AS requestedApprovalMode,
                   ta.started_at AS startedAt,
                   ta.completed_at AS completedAt,
                   ta.error_code AS errorCode,
                   ta.error_message AS errorMessage,
                   ta.created_at AS createdAt,
                   fu.id AS followUpId,
                   fu.parent_attempt_id AS parentAttemptId,
                   fu.feedback AS followUpFeedback,
                   fu.requested_acceptance AS requestedAcceptance,
                   acceptance.decision AS acceptanceDecision,
                   acceptance.reason AS acceptanceReason,
                   acceptance.created_at AS acceptanceAt
            FROM task_attempt ta
            LEFT JOIN task_follow_up fu ON fu.attempt_id = ta.id
            LEFT JOIN LATERAL (
                SELECT aa.decision, aa.reason, aa.created_at
                FROM task_acceptance_audit aa
                WHERE aa.attempt_id = ta.id
                ORDER BY aa.created_at DESC
                LIMIT 1
            ) acceptance ON TRUE
            WHERE ta.task_id = #{taskId}
            ORDER BY ta.attempt_number DESC
            """)
    List<com.zhishu.task.TaskAttemptView> listAttempts(@Param("taskId") UUID taskId);
}
