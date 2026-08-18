package com.zhishu.task;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import com.zhishu.event.TaskLifecycleObserver;
import com.zhishu.runtime.RuntimeCancelCommand;
import com.zhishu.runtime.RuntimeClient;

@Service
public class TaskControlService {

    private final TaskRepository tasks;
    private final TaskControlRepository controls;
    private final ExecutionConfigurationRepository configurations;
    private final TaskOrchestrator orchestrator;
    private final RuntimeClient runtimeClient;
    private final TransactionTemplate transactions;
    private final List<TaskRetryContextProvider> retryContextProviders;
    private final List<TaskLifecycleObserver> lifecycleObservers;

    public TaskControlService(
            TaskRepository tasks,
            TaskControlRepository controls,
            ExecutionConfigurationRepository configurations,
            TaskOrchestrator orchestrator,
            RuntimeClient runtimeClient,
            TransactionTemplate transactions,
            List<TaskRetryContextProvider> retryContextProviders,
            List<TaskLifecycleObserver> lifecycleObservers
    ) {
        this.tasks = tasks;
        this.controls = controls;
        this.configurations = configurations;
        this.orchestrator = orchestrator;
        this.runtimeClient = runtimeClient;
        this.transactions = transactions;
        this.retryContextProviders = List.copyOf(retryContextProviders);
        this.lifecycleObservers = List.copyOf(lifecycleObservers);
    }

    public TaskView cancel(UUID taskId) {
        TaskView task = requireCurrentAttempt(taskId, true);
        if (isTerminal(task.status())) {
            return task;
        }
        if (task.status() != AttemptStatus.CANCELLING) {
            Boolean claimed = transactions.execute(status -> {
                boolean updated = controls.claimCancellation(taskId, task.attemptId());
                if (!updated) {
                    return false;
                }
                tasks.updateStatusForAttempt(taskId, task.attemptId(), AttemptStatus.CANCELLING);
                controls.expirePendingApprovals(task.attemptId());
                return true;
            });
            if (!Boolean.TRUE.equals(claimed)) {
                throw new InvalidTaskStateException(task.status(), AttemptStatus.CANCELLING);
            }
        }
        runtimeClient.cancel(task.runtimeRunId(), new RuntimeCancelCommand(
                "1.0",
                UUID.randomUUID().toString(),
                task.attemptId() + ":cancel"
        ));
        return tasks.findById(taskId).orElseThrow(() -> new TaskNotFoundException(taskId));
    }

    public TaskView retry(UUID taskId) {
        TaskView task = requireCurrentAttempt(taskId, false);
        if (!isTerminal(task.status())) {
            throw new InvalidTaskStateException(task.status(), AttemptStatus.PENDING);
        }
        RetryDispatch retry = transactions.execute(status -> prepareRetry(task));
        if (retry == null) throw new IllegalStateException("Retry transaction returned no dispatch");
        try {
            orchestrator.dispatch(retry.start(), retry.attempt());
        } catch (RuntimeException error) {
            TaskView current = requireCurrentAttempt(taskId, false);
            if (retry.attempt().id().equals(current.attemptId()) && current.status() != AttemptStatus.PENDING) {
                notifyLifecycle(taskId, current.attemptId(), current.status());
            }
            throw error;
        }
        notifyLifecycle(taskId, retry.attempt().id(), retry.attempt().status());
        return tasks.findById(taskId).orElseThrow(() -> new TaskNotFoundException(taskId));
    }

    private void notifyLifecycle(UUID taskId, UUID attemptId, AttemptStatus status) {
        for (TaskLifecycleObserver observer : lifecycleObservers) {
            observer.observe(taskId, attemptId, status);
        }
    }

    private RetryDispatch prepareRetry(TaskView task) {
        if (!controls.claimRetry(task.taskId(), task.attemptId())) {
            throw new InvalidTaskStateException(task.status(), AttemptStatus.PENDING);
        }
        Map<String, Object> context = new LinkedHashMap<>();
        context.put("retryOfAttemptId", task.attemptId().toString());
        for (TaskRetryContextProvider provider : retryContextProviders) {
            provider.prepareRetry(task).forEach((key, value) -> {
                if (context.putIfAbsent(key, value) != null) {
                    throw new IllegalStateException("Duplicate retry context key: " + key);
                }
            });
        }
        ExecutionConfiguration configuration = configurations
                .findEnabled(task.projectId(), task.profileId())
                .orElseThrow(() -> new TaskNotFoundException(
                        "Enabled project/profile configuration was not found"
                ));
        var approvalPolicy = attemptsPolicy(task.attemptId());
        StartAttemptCommand start = new StartAttemptCommand(
                task.taskId(),
                approvalPolicy.projectRoot(),
                task.objective(),
                orchestrator.profileFor(task.attemptId()),
                approvalPolicy,
                Map.copyOf(context)
        );
        return new RetryDispatch(orchestrator.prepare(start), start);
    }

    private com.zhishu.approval.ApprovalPolicySnapshot attemptsPolicy(UUID attemptId) {
        return orchestrator.approvalPolicyFor(attemptId);
    }

    private TaskView requireCurrentAttempt(UUID taskId, boolean requireRuntimeRun) {
        TaskView task = tasks.findById(taskId).orElseThrow(() -> new TaskNotFoundException(taskId));
        if (task.attemptId() == null || (requireRuntimeRun && task.runtimeRunId() == null)) {
            throw new IllegalStateException("Task does not have the required Runtime attempt state");
        }
        return task;
    }

    private boolean isTerminal(AttemptStatus status) {
        return status == AttemptStatus.SUCCEEDED
                || status == AttemptStatus.FAILED
                || status == AttemptStatus.LOST
                || status == AttemptStatus.ABORTED;
    }

    private record RetryDispatch(TaskAttempt attempt, StartAttemptCommand start) {
    }
}
