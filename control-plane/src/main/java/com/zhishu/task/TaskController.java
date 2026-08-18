package com.zhishu.task;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import com.zhishu.event.TaskEventStreamService;
import com.zhishu.profile.ExecutorType;
import com.zhishu.approval.ApprovalMode;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

@RestController
@RequestMapping("/api/v1/tasks")
public class TaskController {

    private final TaskApplicationService tasks;
    private final TaskControlService controls;
    private final TaskEventStreamService streams;
    private final TaskFollowUpService followUps;
    private final TaskAcceptanceService acceptances;

    public TaskController(
            TaskApplicationService tasks,
            TaskControlService controls,
            TaskEventStreamService streams,
            TaskFollowUpService followUps,
            TaskAcceptanceService acceptances
    ) {
        this.tasks = tasks;
        this.controls = controls;
        this.streams = streams;
        this.followUps = followUps;
        this.acceptances = acceptances;
    }

    @PostMapping("/{taskId}/cancel")
    public ResponseEntity<TaskResponse> cancel(@PathVariable UUID taskId) {
        return ResponseEntity.accepted().body(TaskResponse.from(controls.cancel(taskId)));
    }

    @PostMapping("/{taskId}/retry")
    public ResponseEntity<TaskResponse> retry(@PathVariable UUID taskId) {
        return ResponseEntity.accepted().body(TaskResponse.from(controls.retry(taskId)));
    }

    @PostMapping
    public ResponseEntity<TaskResponse> create(@Valid @RequestBody CreateTaskRequest request) {
        ExecutorType executor = request.executor() == null || request.executor().isBlank()
                ? null
                : ExecutorType.fromWireValue(request.executor().trim());
        TaskView task = tasks.create(new CreateTaskCommand(
                request.projectId(),
                request.profileId(),
                request.title(),
                request.objective(),
                request.connectionRef(),
                executor,
                request.modelAlias(),
                request.approvalMode(),
                request.additionalContext() == null ? Map.of() : Map.copyOf(request.additionalContext())
        ));
        return ResponseEntity.accepted().body(TaskResponse.from(task));
    }

    @GetMapping
    public List<TaskResponse> list(
            @RequestParam(required = false) UUID projectId,
            @RequestParam(defaultValue = "100") int limit
    ) {
        return tasks.list(projectId, limit).stream().map(TaskResponse::from).toList();
    }

    @GetMapping("/{taskId}")
    public TaskResponse get(@PathVariable UUID taskId) {
        return TaskResponse.from(tasks.get(taskId));
    }

    @DeleteMapping("/{taskId}")
    public ResponseEntity<Void> delete(@PathVariable UUID taskId) {
        tasks.delete(taskId);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/{taskId}/attempts")
    public List<TaskAttemptView> attempts(@PathVariable UUID taskId) {
        return tasks.attempts(taskId);
    }

    @PostMapping("/{taskId}/follow-ups")
    public ResponseEntity<TaskFollowUpView> followUp(
            @PathVariable UUID taskId,
            @Valid @RequestBody FollowUpRequest request
    ) {
        ExecutorType executor = request.executor() == null || request.executor().isBlank()
                ? null
                : ExecutorType.fromWireValue(request.executor().trim());
        TaskFollowUpView created = followUps.create(taskId, new TaskFollowUpCommand(
                request.parentAttemptId(), request.clientRequestId(), request.actor(),
                request.feedback().trim(), request.requestedAcceptance().trim(),
                request.connectionRef(), executor, request.modelAlias(), request.approvalMode(),
                request.additionalContext() == null ? Map.of() : Map.copyOf(request.additionalContext())
        ));
        return ResponseEntity.accepted().body(created);
    }

    @GetMapping("/{taskId}/follow-ups")
    public List<TaskFollowUpView> followUps(@PathVariable UUID taskId) {
        return followUps.list(taskId);
    }

    @PostMapping("/{taskId}/acceptance")
    public TaskAcceptanceView acceptance(
            @PathVariable UUID taskId,
            @Valid @RequestBody AcceptanceRequest request
    ) {
        return acceptances.decide(taskId, new TaskAcceptanceCommand(
                request.attemptId(), request.clientRequestId(), request.actor(),
                request.decision(), request.reason()
        ));
    }

    @GetMapping(path = "/{taskId}/events", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter events(
            @PathVariable UUID taskId,
            @RequestHeader(name = "Last-Event-ID", required = false) String lastEventId
    ) {
        return streams.subscribe(taskId, parseLastEventId(lastEventId));
    }

    private long parseLastEventId(String value) {
        if (value == null || value.isBlank()) {
            return 0L;
        }
        try {
            long parsed = Long.parseLong(value);
            if (parsed < 0) {
                throw new IllegalArgumentException("Last-Event-ID cannot be negative");
            }
            return parsed;
        } catch (NumberFormatException error) {
            throw new IllegalArgumentException("Last-Event-ID must be an integer", error);
        }
    }

    public record CreateTaskRequest(
            @NotNull UUID projectId,
            @NotNull UUID profileId,
            @NotBlank @Size(max = 200) String title,
            @NotBlank String objective,
            String connectionRef,
            String executor,
            String modelAlias,
            ApprovalMode approvalMode,
            Map<String, Object> additionalContext
    ) {
    }

    public record TaskResponse(
            UUID taskId,
            UUID projectId,
            UUID profileId,
            String title,
            String objective,
            AttemptStatus status,
            AttemptStatus attemptStatus,
            ResolutionStatus resolutionStatus,
            UUID attemptId,
            Integer attemptNumber,
            String runtimeRunId,
            com.zhishu.runtime.RuntimeHealthStatus runtimeHealthStatus,
            Instant lastHeartbeatAt,
            Instant leaseExpiresAt,
            Instant unknownSince,
            Instant lostAt,
            String lostReason,
            Instant createdAt,
            Instant startedAt,
            Instant completedAt,
            String errorCode,
            String errorMessage
    ) {
        static TaskResponse from(TaskView view) {
            return new TaskResponse(
                    view.taskId(), view.projectId(), view.profileId(), view.title(), view.objective(),
                    view.status(), view.attemptStatus(), view.resolutionStatus(), view.attemptId(),
                    view.attemptNumber(), view.runtimeRunId(),
                    view.runtimeHealthStatus(), view.lastHeartbeatAt(), view.leaseExpiresAt(),
                    view.unknownSince(), view.lostAt(), view.lostReason(),
                    view.createdAt(), view.startedAt(), view.completedAt(),
                    view.errorCode(), view.errorMessage()
            );
        }
    }

    public record FollowUpRequest(
            @NotNull UUID parentAttemptId,
            @NotBlank @Size(max = 120) String clientRequestId,
            @NotBlank @Size(max = 120) String actor,
            @NotBlank @Size(max = 20_000) String feedback,
            @NotBlank @Size(max = 20_000) String requestedAcceptance,
            String connectionRef,
            String executor,
            String modelAlias,
            ApprovalMode approvalMode,
            Map<String, Object> additionalContext
    ) {
    }

    public record AcceptanceRequest(
            @NotNull UUID attemptId,
            @NotBlank @Size(max = 120) String clientRequestId,
            @NotBlank @Size(max = 120) String actor,
            @NotNull AcceptanceDecision decision,
            @NotBlank @Size(max = 20_000) String reason
    ) {
    }
}
