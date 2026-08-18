package com.zhishu.task;

import java.time.Clock;
import java.time.Instant;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class TaskAcceptanceService {

    private final TaskRepository tasks;
    private final TaskAcceptanceRepository acceptances;
    private final TransactionTemplate transactions;
    private final Clock clock;

    @Autowired
    public TaskAcceptanceService(
            TaskRepository tasks,
            TaskAcceptanceRepository acceptances,
            TransactionTemplate transactions
    ) {
        this(tasks, acceptances, transactions, Clock.systemUTC());
    }

    TaskAcceptanceService(
            TaskRepository tasks,
            TaskAcceptanceRepository acceptances,
            TransactionTemplate transactions,
            Clock clock
    ) {
        this.tasks = tasks;
        this.acceptances = acceptances;
        this.transactions = transactions;
        this.clock = clock;
    }

    public TaskAcceptanceView decide(UUID taskId, TaskAcceptanceCommand command) {
        TaskAcceptanceView existing = acceptances
                .findByClientRequestId(taskId, command.clientRequestId())
                .orElse(null);
        if (existing != null) {
            ensureSameRequest(existing, command);
            return existing;
        }

        TaskView task = tasks.findById(taskId).orElseThrow(() -> new TaskNotFoundException(taskId));
        if (!task.attemptStatus().isTerminal() || task.attemptId() == null
                || !task.attemptId().equals(command.attemptId())) {
            throw new InvalidTaskStateException(
                    "Acceptance must target the current terminal Attempt for task " + taskId
            );
        }
        ResolutionStatus target = command.decision().resolutionStatus();
        TaskAcceptanceView decision = new TaskAcceptanceView(
                UUID.randomUUID(), taskId, command.attemptId(), command.clientRequestId(),
                command.actor(), command.decision(), command.reason(), clock.instant()
        );
        try {
            transactions.executeWithoutResult(status -> {
                acceptances.insert(decision);
                if (!acceptances.updateResolution(taskId, command.attemptId(), target)) {
                    throw new InvalidTaskStateException("Task acceptance changed concurrently: " + taskId);
                }
            });
        } catch (org.springframework.dao.DataIntegrityViolationException error) {
            TaskAcceptanceView replay = acceptances
                    .findByClientRequestId(taskId, command.clientRequestId())
                    .orElseThrow(() -> error);
            ensureSameRequest(replay, command);
            return replay;
        }
        return decision;
    }

    private void ensureSameRequest(TaskAcceptanceView existing, TaskAcceptanceCommand command) {
        if (!existing.attemptId().equals(command.attemptId())
                || !existing.actor().equals(command.actor())
                || existing.decision() != command.decision()
                || !java.util.Objects.equals(existing.reason(), command.reason())) {
            throw new InvalidTaskStateException("Acceptance clientRequestId was reused with different content");
        }
    }
}
