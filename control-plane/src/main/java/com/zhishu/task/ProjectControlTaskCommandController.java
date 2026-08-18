package com.zhishu.task;

import java.util.Map;
import java.util.UUID;

import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.zhishu.approval.ApprovalMode;
import com.zhishu.profile.ExecutorType;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/** Authenticated service-to-service commands used by the independent Task Center Gateway. */
@RestController
@RequestMapping("/internal/project-control/v1/tasks")
public class ProjectControlTaskCommandController {

    private final TaskApplicationService tasks;
    private final TaskControlService controls;
    private final TaskFollowUpService followUps;
    private final TaskAcceptanceService acceptances;

    public ProjectControlTaskCommandController(
            TaskApplicationService tasks,
            TaskControlService controls,
            TaskFollowUpService followUps,
            TaskAcceptanceService acceptances
    ) {
        this.tasks = tasks;
        this.controls = controls;
        this.followUps = followUps;
        this.acceptances = acceptances;
    }

    @PostMapping("/{taskId}/cancel")
    public ResponseEntity<TaskController.TaskResponse> cancel(
            @PathVariable UUID taskId,
            @RequestHeader("X-Zhishu-Actor") String actor
    ) {
        requireActor(actor);
        return ResponseEntity.accepted().body(TaskController.TaskResponse.from(controls.cancel(taskId)));
    }

    @PostMapping("/{taskId}/retry")
    public ResponseEntity<TaskController.TaskResponse> retry(
            @PathVariable UUID taskId,
            @RequestHeader("X-Zhishu-Actor") String actor
    ) {
        requireActor(actor);
        return ResponseEntity.accepted().body(TaskController.TaskResponse.from(controls.retry(taskId)));
    }

    @PostMapping("/{taskId}/archive")
    public TaskHistoryResponse archive(
            @PathVariable UUID taskId,
            @RequestHeader("X-Zhishu-Actor") String actor,
            @Valid @RequestBody ArchiveCommandRequest request
    ) {
        return TaskHistoryResponse.from(tasks.archive(taskId, requireActor(actor), request.reason().trim()));
    }

    @PostMapping("/{taskId}/follow-ups")
    public ResponseEntity<TaskFollowUpView> followUp(
            @PathVariable UUID taskId,
            @RequestHeader("X-Zhishu-Actor") String actor,
            @Valid @RequestBody FollowUpCommandRequest request
    ) {
        ExecutorType executor = request.executor() == null || request.executor().isBlank()
                ? null
                : ExecutorType.fromWireValue(request.executor().trim());
        TaskFollowUpView created = followUps.create(taskId, new TaskFollowUpCommand(
                request.parentAttemptId(), request.clientRequestId(), requireActor(actor),
                request.feedback().trim(), request.requestedAcceptance().trim(),
                request.connectionRef(), executor, request.modelAlias(), request.approvalMode(),
                request.additionalContext() == null ? Map.of() : Map.copyOf(request.additionalContext())
        ));
        return ResponseEntity.accepted().body(created);
    }

    @PostMapping("/{taskId}/acceptance")
    public TaskAcceptanceView acceptance(
            @PathVariable UUID taskId,
            @RequestHeader("X-Zhishu-Actor") String actor,
            @Valid @RequestBody AcceptanceCommandRequest request
    ) {
        return acceptances.decide(taskId, new TaskAcceptanceCommand(
                request.attemptId(), request.clientRequestId(), requireActor(actor),
                request.decision(), request.reason().trim()
        ));
    }

    private String requireActor(String actor) {
        if (actor == null || actor.isBlank()) {
            throw new IllegalArgumentException("X-Zhishu-Actor is required");
        }
        return actor.trim();
    }

    public record FollowUpCommandRequest(
            @NotNull UUID parentAttemptId,
            @NotBlank @Size(max = 120) String clientRequestId,
            @NotBlank @Size(max = 20_000) String feedback,
            @NotBlank @Size(max = 20_000) String requestedAcceptance,
            String connectionRef,
            String executor,
            String modelAlias,
            ApprovalMode approvalMode,
            Map<String, Object> additionalContext
    ) {
    }

    public record AcceptanceCommandRequest(
            @NotNull UUID attemptId,
            @NotBlank @Size(max = 120) String clientRequestId,
            @NotNull AcceptanceDecision decision,
            @NotBlank @Size(max = 20_000) String reason
    ) {
    }

    public record ArchiveCommandRequest(
            @NotBlank @Size(max = 2_000) String reason
    ) {
    }
}
