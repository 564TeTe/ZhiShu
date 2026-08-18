package com.zhishu.task.persistence;

import java.time.Instant;
import java.util.UUID;

import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import com.zhishu.task.TaskAcceptanceView;

@Mapper
interface TaskAcceptanceMapper {

    String COLUMNS = """
            SELECT id, task_id AS "taskId", attempt_id AS "attemptId",
                   client_request_id AS "clientRequestId", actor, decision, reason, created_at AS "createdAt"
            FROM task_acceptance_audit
            """;

    @Select(COLUMNS + " WHERE task_id = #{taskId} AND client_request_id = #{clientRequestId}")
    TaskAcceptanceView findByClientRequestId(
            @Param("taskId") UUID taskId,
            @Param("clientRequestId") String clientRequestId
    );

    @Insert("""
            INSERT INTO task_acceptance_audit (
                id, task_id, attempt_id, client_request_id, actor, decision, reason, created_at
            ) VALUES (
                #{id}, #{taskId}, #{attemptId}, #{clientRequestId}, #{actor}, #{decision}, #{reason}, #{createdAt}
            )
            """)
    int insert(
            @Param("id") UUID id,
            @Param("taskId") UUID taskId,
            @Param("attemptId") UUID attemptId,
            @Param("clientRequestId") String clientRequestId,
            @Param("actor") String actor,
            @Param("decision") String decision,
            @Param("reason") String reason,
            @Param("createdAt") Instant createdAt
    );

    @Update("""
            UPDATE agent_task
            SET resolution_status = #{target},
                resolution_version = resolution_version + 1,
                updated_at = now()
            WHERE id = #{taskId}
              AND current_attempt_id = #{attemptId}
              AND status IN ('SUCCEEDED', 'FAILED', 'ABORTED')
              AND resolution_status IN ('WAITING_ACCEPTANCE', 'NEEDS_FOLLOW_UP')
            """)
    int updateResolution(
            @Param("taskId") UUID taskId,
            @Param("attemptId") UUID attemptId,
            @Param("target") String target
    );
}
