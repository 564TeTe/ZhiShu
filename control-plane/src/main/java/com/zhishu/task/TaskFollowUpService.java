package com.zhishu.task;

import java.nio.file.Path;
import java.time.Clock;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import com.zhishu.artifact.TaskArtifactService;
import com.zhishu.artifact.TaskArtifactView;
import com.zhishu.approval.ProjectApprovalPolicyService;
import com.zhishu.profile.AgentProfileSnapshot;
import com.zhishu.profile.ExecutorType;

@Service
public class TaskFollowUpService {

    private static final int MAX_CONTEXT_TEXT = 12_000;
    private static final int MAX_HISTORY_ATTEMPTS = 12;
    private static final int MAX_HISTORY_EVIDENCE_TEXT = 2_400;

    private final TaskRepository tasks;
    private final TaskAttemptRepository attempts;
    private final TaskFollowUpRepository followUps;
    private final ExecutionConfigurationRepository configurations;
    private final TaskArtifactService artifacts;
    private final TaskOrchestrator orchestrator;
    private final ProjectApprovalPolicyService approvalPolicies;
    private final TransactionTemplate transactions;
    private final Clock clock;

    @Autowired
    public TaskFollowUpService(
            TaskRepository tasks,
            TaskAttemptRepository attempts,
            TaskFollowUpRepository followUps,
            ExecutionConfigurationRepository configurations,
            TaskArtifactService artifacts,
            TaskOrchestrator orchestrator,
            ProjectApprovalPolicyService approvalPolicies,
            TransactionTemplate transactions
    ) {
        this(tasks, attempts, followUps, configurations, artifacts, orchestrator,
                approvalPolicies, transactions, Clock.systemUTC());
    }

    TaskFollowUpService(
            TaskRepository tasks,
            TaskAttemptRepository attempts,
            TaskFollowUpRepository followUps,
            ExecutionConfigurationRepository configurations,
            TaskArtifactService artifacts,
            TaskOrchestrator orchestrator,
            ProjectApprovalPolicyService approvalPolicies,
            TransactionTemplate transactions,
            Clock clock
    ) {
        this.tasks = tasks;
        this.attempts = attempts;
        this.followUps = followUps;
        this.configurations = configurations;
        this.artifacts = artifacts;
        this.orchestrator = orchestrator;
        this.approvalPolicies = approvalPolicies;
        this.transactions = transactions;
        this.clock = clock;
    }

    public TaskFollowUpView create(UUID taskId, TaskFollowUpCommand command) {
        TaskFollowUpView replay = followUps
                .findByClientRequestId(taskId, command.clientRequestId())
                .orElse(null);
        if (replay != null) {
            ensureSameRequest(replay, command);
            return replay;
        }

        TaskView task = tasks.findById(taskId).orElseThrow(() -> new TaskNotFoundException(taskId));
        if (task.attemptId() == null || !task.attemptId().equals(command.parentAttemptId())
                || !task.attemptStatus().isTerminal()
                || task.resolutionStatus() == ResolutionStatus.RESOLVED
                || task.resolutionStatus() == ResolutionStatus.CLOSED) {
            throw new InvalidTaskStateException(
                    "Follow-up requires the current terminal Attempt and an open acceptance state"
            );
        }

        ExecutionConfiguration configuration = configurations
                .findEnabled(task.projectId(), task.profileId())
                .orElseThrow(() -> new TaskNotFoundException(
                        "Enabled project/profile configuration was not found"
                ));
        AgentProfileSnapshot previousSnapshot = attempts.findProfileSnapshot(task.attemptId())
                .orElse(configuration.profileSnapshot());
        AgentProfileSnapshot snapshot = resolveProfileSnapshot(configuration, previousSnapshot, command);
        var previousApprovalPolicy = attempts.findApprovalPolicySnapshot(task.attemptId())
                .orElseThrow(() -> new TaskNotFoundException("Approval policy snapshot was not found"));
        boolean preservePreviousRoot = Path.of(previousApprovalPolicy.projectRoot()).isAbsolute();
        String executionRoot = preservePreviousRoot
                ? previousApprovalPolicy.projectRoot()
                : configuration.projectRef();
        var approvalPolicy = command.approvalMode() == null
                ? preservePreviousRoot
                        ? previousApprovalPolicy
                        : new com.zhishu.approval.ApprovalPolicySnapshot(
                                previousApprovalPolicy.mode(), previousApprovalPolicy.requestedMode(), executionRoot,
                                previousApprovalPolicy.allowedDirectories(), previousApprovalPolicy.trustedCommands(),
                                previousApprovalPolicy.approvalTimeoutSeconds()
                        )
                : preservePreviousRoot
                        ? approvalPolicies.resolveForRoot(task.projectId(), command.approvalMode(), executionRoot)
                        : approvalPolicies.resolve(task.projectId(), command.approvalMode());
        UUID followUpId = UUID.randomUUID();
        Map<String, Object> context = structuredContext(task, command, followUpId);
        StartAttemptCommand start = new StartAttemptCommand(
                taskId,
                executionRoot,
                task.objective(),
                snapshot,
                approvalPolicy,
                context
        );

        PreparedFollowUp prepared;
        try {
            prepared = transactions.execute(status -> {
                if (!tasks.claimFollowUp(taskId, command.parentAttemptId())) {
                    throw new InvalidTaskStateException("Task is already running or has changed: " + taskId);
                }
                TaskAttempt attempt = orchestrator.prepare(start);
                TaskFollowUp followUp = new TaskFollowUp(
                        followUpId,
                        taskId,
                        command.parentAttemptId(),
                        attempt.id(),
                        command.clientRequestId(),
                        command.actor(),
                        command.feedback(),
                        command.requestedAcceptance(),
                        command.additionalContext(),
                        clock.instant()
                );
                followUps.insert(followUp);
                return new PreparedFollowUp(followUp, attempt);
            });
        } catch (DataIntegrityViolationException error) {
            TaskFollowUpView existing = followUps
                    .findByClientRequestId(taskId, command.clientRequestId())
                    .orElseThrow(() -> error);
            ensureSameRequest(existing, command);
            return existing;
        } catch (InvalidTaskStateException error) {
            TaskFollowUpView existing = followUps
                    .findByClientRequestId(taskId, command.clientRequestId())
                    .orElse(null);
            if (existing == null) throw error;
            ensureSameRequest(existing, command);
            return existing;
        }

        orchestrator.dispatch(start, prepared.attempt());
        return followUps.findByClientRequestId(taskId, command.clientRequestId())
                .orElseThrow(() -> new TaskNotFoundException("Follow-up was not persisted: " + followUpId));
    }

    public List<TaskFollowUpView> list(UUID taskId) {
        tasks.findIncludingArchivedById(taskId).orElseThrow(() -> new TaskNotFoundException(taskId));
        return followUps.findByTaskId(taskId);
    }

    private Map<String, Object> structuredContext(
            TaskView task,
            TaskFollowUpCommand command,
            UUID followUpId
    ) {
        List<TaskAttemptView> allAttempts = tasks.listAttempts(task.taskId());
        TaskAttemptView previous = allAttempts.stream()
                .filter(attempt -> attempt.attemptId().equals(command.parentAttemptId()))
                .findFirst()
                .orElseThrow(() -> new TaskNotFoundException("Parent Attempt was not found: " + command.parentAttemptId()));
        Map<String, Object> previousAttempt = attemptContext(previous, MAX_CONTEXT_TEXT);
        List<TaskAttemptView> historyAttempts = allAttempts.stream()
                .sorted(Comparator.comparingInt(TaskAttemptView::attemptNumber))
                .toList();
        boolean historyTruncated = historyAttempts.size() > MAX_HISTORY_ATTEMPTS;
        if (historyTruncated) {
            List<TaskAttemptView> bounded = new ArrayList<>();
            bounded.add(historyAttempts.get(0));
            bounded.addAll(historyAttempts.subList(
                    Math.max(1, historyAttempts.size() - (MAX_HISTORY_ATTEMPTS - 1)),
                    historyAttempts.size()
            ));
            historyAttempts = bounded;
        }
        List<Map<String, Object>> attemptHistory = historyAttempts.stream()
                .map(attempt -> attemptContext(attempt, MAX_HISTORY_EVIDENCE_TEXT))
                .toList();

        Map<String, Object> followUp = new LinkedHashMap<>();
        followUp.put("contextType", "TASK_FOLLOW_UP_V1");
        followUp.put("followUpId", followUpId.toString());
        followUp.put("parentAttemptId", command.parentAttemptId().toString());
        followUp.put("originalObjective", task.objective());
        followUp.put("previousAttempt", previousAttempt);
        followUp.put("attemptHistory", attemptHistory);
        followUp.put("historyTruncated", historyTruncated);
        followUp.put("userFeedback", command.feedback());
        followUp.put("requestedAcceptance", command.requestedAcceptance());
        followUp.put("additionalContext", command.additionalContext());
        return Map.of("taskFollowUpContext", followUp);
    }

    private Map<String, Object> attemptContext(TaskAttemptView attempt, int evidenceLimit) {
        Map<String, Object> context = new LinkedHashMap<>();
        context.put("attemptId", attempt.attemptId().toString());
        context.put("attemptNumber", attempt.attemptNumber());
        context.put("status", attempt.status().name());
        if (attempt.executor() != null) context.put("executor", attempt.executor());
        if (attempt.modelAlias() != null) context.put("modelAlias", attempt.modelAlias());
        if (attempt.followUpId() != null) context.put("followUpId", attempt.followUpId().toString());
        if (attempt.parentAttemptId() != null) context.put("parentAttemptId", attempt.parentAttemptId().toString());
        if (attempt.followUpFeedback() != null) context.put("userFeedback", trim(attempt.followUpFeedback()));
        if (attempt.requestedAcceptance() != null) context.put("requestedAcceptance", trim(attempt.requestedAcceptance()));
        if (attempt.acceptanceDecision() != null) context.put("acceptanceDecision", attempt.acceptanceDecision().name());
        if (attempt.acceptanceReason() != null) context.put("acceptanceReason", trim(attempt.acceptanceReason()));
        if (attempt.errorCode() != null) context.put("failureCode", attempt.errorCode());
        if (attempt.errorMessage() != null) context.put("failureReason", trim(attempt.errorMessage()));
        context.put("evidence", evidenceFor(attempt.attemptId(), evidenceLimit));
        return context;
    }

    private List<Map<String, Object>> evidenceFor(UUID attemptId, int contentLimit) {
        List<Map<String, Object>> evidence = new ArrayList<>();
        for (TaskArtifactView artifact : artifacts.findByAttemptId(attemptId)) {
            String type = artifact.artifactType().name();
            if (!List.of("SUMMARY", "FILE_CHANGE", "TEST_REPORT", "ERROR_REPORT").contains(type)) continue;
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("type", type);
            item.put("content", trimTo(artifact.contentPlain(), contentLimit));
            item.put("metadata", artifact.metadata());
            evidence.add(item);
        }
        return evidence;
    }

    private void ensureSameRequest(TaskFollowUpView existing, TaskFollowUpCommand command) {
        if (!existing.parentAttemptId().equals(command.parentAttemptId())
                || !existing.actor().equals(command.actor())
                || !existing.feedback().equals(command.feedback())
                || !existing.requestedAcceptance().equals(command.requestedAcceptance())
                || !existing.additionalContext().equals(command.additionalContext())) {
            throw new InvalidTaskStateException("Follow-up clientRequestId was reused with different content");
        }
        AgentProfileSnapshot snapshot = attempts.findProfileSnapshot(existing.attemptId())
                .orElseThrow(() -> new TaskNotFoundException("Follow-up profile snapshot was not found"));
        if ((command.executor() != null && command.executor() != snapshot.executor())
                || (command.modelAlias() != null && !command.modelAlias().isBlank()
                    && !Objects.equals(command.modelAlias().trim(), snapshot.modelAlias()))
                || (command.connectionRef() != null && !command.connectionRef().isBlank()
                    && !Objects.equals(command.connectionRef().trim(), snapshot.connectionRef()))) {
            throw new InvalidTaskStateException("Follow-up clientRequestId was reused with different execution settings");
        }
        if (command.approvalMode() != null) {
            var stored = attempts.findApprovalPolicySnapshot(existing.attemptId())
                    .orElseThrow(() -> new TaskNotFoundException("Follow-up approval snapshot was not found"));
            TaskView task = tasks.findById(existing.taskId())
                    .orElseThrow(() -> new TaskNotFoundException(existing.taskId()));
            var effective = approvalPolicies.resolve(task.projectId(), command.approvalMode());
            if (stored.mode() != effective.mode()) {
                throw new InvalidTaskStateException("Follow-up clientRequestId was reused with different approval settings");
            }
        }
    }

    private AgentProfileSnapshot resolveProfileSnapshot(
            ExecutionConfiguration configuration,
            AgentProfileSnapshot previous,
            TaskFollowUpCommand command
    ) {
        AgentProfileSnapshot snapshot = previous;
        if (command.executor() != null && command.executor() != previous.executor()) {
            snapshot = configuration.profileSnapshot()
                    .withConnectionRef(null)
                    .withModelAlias(null)
                    .withExecutor(command.executor());
        } else if (command.executor() != null) {
            snapshot = snapshot.withExecutor(command.executor());
        }
        if (command.modelAlias() != null && !command.modelAlias().isBlank()) {
            snapshot = snapshot.withModelAlias(command.modelAlias().trim());
        }
        if (snapshot.executor() == ExecutorType.OPENCODE) {
            return snapshot.asReadOnly();
        }
        if (snapshot.executor() != ExecutorType.CLAUDE) {
            return snapshot.withConnectionRef(null);
        }
        if (command.connectionRef() != null && !command.connectionRef().isBlank()) {
            return snapshot.withConnectionRef(command.connectionRef().trim());
        }
        return snapshot;
    }

    private String trim(String value) {
        return trimTo(value, MAX_CONTEXT_TEXT);
    }

    private String trimTo(String value, int limit) {
        if (value == null) return null;
        return value.length() <= limit ? value : value.substring(0, limit) + "\n[truncated]";
    }

    private record PreparedFollowUp(TaskFollowUp followUp, TaskAttempt attempt) {
    }
}
