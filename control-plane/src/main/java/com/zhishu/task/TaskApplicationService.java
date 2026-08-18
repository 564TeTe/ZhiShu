package com.zhishu.task;

import java.time.Clock;
import java.time.Instant;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.zhishu.profile.AgentProfileSnapshot;
import com.zhishu.profile.ExecutorType;
import com.zhishu.approval.ProjectApprovalPolicyService;

@Service
public class TaskApplicationService {

    private final TaskRepository tasks;
    private final ExecutionConfigurationRepository configurations;
    private final TaskOrchestrator orchestrator;
    private final ProjectApprovalPolicyService approvalPolicies;
    private final Clock clock;

    @Autowired
    public TaskApplicationService(
            TaskRepository tasks,
            ExecutionConfigurationRepository configurations,
            TaskOrchestrator orchestrator,
            ProjectApprovalPolicyService approvalPolicies
    ) {
        this(tasks, configurations, orchestrator, approvalPolicies, Clock.systemUTC());
    }

    TaskApplicationService(
            TaskRepository tasks,
            ExecutionConfigurationRepository configurations,
            TaskOrchestrator orchestrator,
            ProjectApprovalPolicyService approvalPolicies,
            Clock clock
    ) {
        this.tasks = tasks;
        this.configurations = configurations;
        this.orchestrator = orchestrator;
        this.approvalPolicies = approvalPolicies;
        this.clock = clock;
    }

    TaskApplicationService(
            TaskRepository tasks,
            ExecutionConfigurationRepository configurations,
            TaskOrchestrator orchestrator,
            Clock clock
    ) {
        this(tasks, configurations, orchestrator, null, clock);
    }

    public TaskView create(CreateTaskCommand command) {
        PreparedTask prepared = prepare(command);
        dispatch(prepared);
        return get(prepared.taskId());
    }

    /**
     * Persists the existing Task and its first PENDING Attempt without crossing
     * the Runtime network boundary. Callers may therefore atomically attach
     * their own durable binding before dispatching the prepared Attempt.
     */
    public PreparedTask prepare(CreateTaskCommand command) {
        return prepare(command, null);
    }

    /** Used by scheduled Work Orders to freeze an already provisioned Runtime workspace. */
    public PreparedTask prepareInWorkspace(CreateTaskCommand command, String workspacePath) {
        String value = workspacePath == null ? "" : workspacePath.trim();
        if (value.isEmpty()) throw new IllegalArgumentException("workspacePath is required");
        Path root = Path.of(value).normalize();
        if (!root.isAbsolute()) throw new IllegalArgumentException("workspacePath must be absolute");
        return prepare(command, root.toString());
    }

    private PreparedTask prepare(CreateTaskCommand command, String workspacePath) {
        ExecutionConfiguration configuration = configurations
                .findEnabled(command.projectId(), command.profileId())
                .orElseThrow(() -> new TaskNotFoundException(
                        "Enabled project/profile configuration was not found"
                ));

        UUID taskId = UUID.randomUUID();
        Instant now = clock.instant();
        AgentProfileSnapshot profileSnapshot = configuration.profileSnapshot();
        if (command.executor() != null) {
            if (command.executor() != profileSnapshot.executor()) {
                profileSnapshot = profileSnapshot.withConnectionRef(null).withModelAlias(null);
            }
            profileSnapshot = profileSnapshot.withExecutor(command.executor());
        }
        if (command.modelAlias() != null && !command.modelAlias().isBlank()) {
            profileSnapshot = profileSnapshot.withModelAlias(command.modelAlias().trim());
        }
        if (profileSnapshot.executor() == ExecutorType.OPENCODE) {
            profileSnapshot = profileSnapshot.asReadOnly();
        } else if (profileSnapshot.executor() != ExecutorType.CLAUDE) {
            profileSnapshot = profileSnapshot.withConnectionRef(null);
        } else if (command.connectionRef() != null && !command.connectionRef().isBlank()) {
            profileSnapshot = profileSnapshot.withConnectionRef(command.connectionRef().trim());
        }
        AgentTask task = AgentTask.pending(
                taskId,
                command.projectId(),
                command.profileId(),
                command.title(),
                command.objective(),
                now
        );
        // This insert intentionally commits before the Runtime network boundary.
        tasks.insert(task);

        String projectRef = workspacePath == null ? configuration.projectRef() : workspacePath;
        StartAttemptCommand start = new StartAttemptCommand(
                taskId,
                projectRef,
                command.objective(),
                profileSnapshot,
                approvalPolicies == null
                        ? com.zhishu.approval.ApprovalPolicySnapshot.manual(projectRef)
                        : workspacePath == null
                                ? approvalPolicies.resolve(command.projectId(), command.approvalMode())
                                : approvalPolicies.resolveForRoot(
                                        command.projectId(), command.approvalMode(), projectRef
                                ),
                command.additionalContext() == null ? Map.of() : command.additionalContext()
        );
        TaskAttempt attempt = orchestrator.prepare(start);
        return new PreparedTask(taskId, attempt, start);
    }

    /** Dispatches one already durable Task/Attempt pair across the Runtime boundary. */
    public TaskAttempt dispatch(PreparedTask prepared) {
        return orchestrator.dispatch(prepared.startCommand(), prepared.attempt());
    }

    /** Rebuilds the Runtime command for a durable current PENDING Attempt. */
    public PreparedTask restorePending(
            UUID taskId,
            UUID attemptId,
            String objective,
            Map<String, Object> additionalContext
    ) {
        TaskView task = get(taskId);
        if (!attemptId.equals(task.attemptId()) || task.status() != AttemptStatus.PENDING) {
            throw new InvalidTaskStateException("Task does not reference the pending Attempt being recovered");
        }
        TaskAttempt attempt = orchestrator.restorePending(attemptId);
        StartAttemptCommand start = new StartAttemptCommand(
                taskId,
                attempt.approvalPolicySnapshot().projectRoot(),
                objective,
                attempt.profileSnapshot(),
                attempt.approvalPolicySnapshot(),
                additionalContext == null ? Map.of() : Map.copyOf(additionalContext)
        );
        return new PreparedTask(taskId, attempt, start);
    }

    public TaskView get(UUID taskId) {
        return tasks.findById(taskId).orElseThrow(() -> new TaskNotFoundException(taskId));
    }

    public TaskView getForProject(UUID projectId, UUID taskId) {
        return tasks.findByProjectAndId(projectId, taskId)
                .orElseThrow(() -> new TaskNotFoundException(taskId));
    }

    public List<TaskView> list(UUID projectId, int limit) {
        return tasks.list(projectId, Math.max(1, Math.min(limit, 200)));
    }

    public TaskSearchResult search(
            UUID projectId,
            TaskArchiveScope archiveScope,
            AttemptStatus status,
            ResolutionStatus resolutionStatus,
            String search,
            String cursor,
            int limit
    ) {
        int pageSize = Math.max(1, Math.min(limit, 100));
        String normalizedSearch = normalizeSearch(search);
        TaskCursor decodedCursor = decodeCursor(cursor);
        List<TaskView> fetched = tasks.search(new TaskSearchCriteria(
                projectId,
                archiveScope == null ? TaskArchiveScope.ACTIVE : archiveScope,
                status,
                resolutionStatus,
                normalizedSearch == null ? null : "%" + escapeLike(normalizedSearch) + "%",
                decodedCursor == null ? null : decodedCursor.createdAt(),
                decodedCursor == null ? null : decodedCursor.taskId(),
                pageSize + 1
        ));
        boolean hasMore = fetched.size() > pageSize;
        List<TaskView> items = hasMore ? List.copyOf(fetched.subList(0, pageSize)) : List.copyOf(fetched);
        String nextCursor = hasMore && !items.isEmpty() ? encodeCursor(items.get(items.size() - 1)) : null;
        return new TaskSearchResult(items, nextCursor, hasMore);
    }

    public List<TaskAttemptView> attempts(UUID taskId) {
        tasks.findIncludingArchivedById(taskId).orElseThrow(() -> new TaskNotFoundException(taskId));
        return tasks.listAttempts(taskId);
    }

    public List<TaskAttemptView> attemptsForProject(UUID projectId, UUID taskId) {
        getForProject(projectId, taskId);
        return tasks.listAttempts(taskId);
    }

    public void delete(UUID taskId) {
        archive(taskId, "legacy-control-v1", "Archived through the compatibility DELETE endpoint.");
    }

    public TaskView archive(UUID taskId, String actor, String reason) {
        if (actor == null || actor.isBlank()) throw new IllegalArgumentException("actor is required");
        TaskView task = tasks.findIncludingArchivedById(taskId)
                .orElseThrow(() -> new TaskNotFoundException(taskId));
        if (task.archivedAt() != null) {
            return task;
        }
        if (!isTerminal(task.status())) {
            throw new InvalidTaskStateException(
                    "Only succeeded, failed, lost, or aborted tasks can be archived; current status is " + task.status()
            );
        }
        if (!tasks.archiveIfTerminal(taskId, actor.trim(), reason == null ? null : reason.trim())) {
            TaskView current = tasks.findByProjectAndId(task.projectId(), taskId)
                    .orElseThrow(() -> new TaskNotFoundException(taskId));
            if (current.archivedAt() != null) {
                return current;
            }
            throw new InvalidTaskStateException(
                    "Task status changed while archiving; current status is " + current.status()
            );
        }
        return tasks.findByProjectAndId(task.projectId(), taskId)
                .orElseThrow(() -> new TaskNotFoundException(taskId));
    }

    private String normalizeSearch(String search) {
        if (search == null || search.isBlank()) return null;
        String normalized = search.trim().toLowerCase(java.util.Locale.ROOT);
        if (normalized.length() > 200) {
            throw new IllegalArgumentException("search cannot exceed 200 characters");
        }
        return normalized;
    }

    private String escapeLike(String search) {
        return search.replace("!", "!!").replace("%", "!%").replace("_", "!_");
    }

    private String encodeCursor(TaskView task) {
        String value = task.createdAt() + "|" + task.taskId();
        return Base64.getUrlEncoder().withoutPadding()
                .encodeToString(value.getBytes(StandardCharsets.UTF_8));
    }

    private TaskCursor decodeCursor(String cursor) {
        if (cursor == null || cursor.isBlank()) return null;
        try {
            String decoded = new String(Base64.getUrlDecoder().decode(cursor.trim()), StandardCharsets.UTF_8);
            String[] parts = decoded.split("\\|", -1);
            if (parts.length != 2) throw new IllegalArgumentException("invalid task history cursor");
            return new TaskCursor(Instant.parse(parts[0]), UUID.fromString(parts[1]));
        } catch (RuntimeException error) {
            throw new IllegalArgumentException("invalid task history cursor", error);
        }
    }

    private boolean isTerminal(AttemptStatus status) {
        return status == AttemptStatus.SUCCEEDED
                || status == AttemptStatus.FAILED
                || status == AttemptStatus.LOST
                || status == AttemptStatus.ABORTED;
    }

    public record PreparedTask(UUID taskId, TaskAttempt attempt, StartAttemptCommand startCommand) {
    }

    private record TaskCursor(Instant createdAt, UUID taskId) {
    }
}
