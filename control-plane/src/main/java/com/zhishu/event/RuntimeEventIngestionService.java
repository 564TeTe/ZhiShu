package com.zhishu.event;

import java.util.LinkedHashSet;
import java.util.Set;
import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.beans.factory.annotation.Autowired;
import com.zhishu.approval.ApprovalService;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

@Service
public class RuntimeEventIngestionService {

    private final TaskEventRepository events;
    private final RuntimeEventProjector projector;
    private final TaskEventStreamService streams;
    private final ApprovalService approvals;

    @Autowired
    public RuntimeEventIngestionService(
            TaskEventRepository events,
            RuntimeEventProjector projector,
            TaskEventStreamService streams,
            ApprovalService approvals
    ) {
        this.events = events;
        this.projector = projector;
        this.streams = streams;
        this.approvals = approvals;
    }

    RuntimeEventIngestionService(
            TaskEventRepository events,
            RuntimeEventProjector projector,
            TaskEventStreamService streams
    ) {
        this(events, projector, streams, null);
    }

    @Transactional
    public RuntimeEventIngestionResult ingest(RuntimeEventBatch batch) {
        int accepted = 0;
        Set<UUID> attemptIds = new LinkedHashSet<>();
        Set<UUID> taskIds = new LinkedHashSet<>();

        for (RuntimeEvent event : batch.events()) {
            if (!batch.protocolVersion().equals(event.protocolVersion())) {
                throw new RuntimeEventRejectedException("Batch and event protocol versions differ");
            }
            if (!events.attemptMatches(event.taskId(), event.attemptId(), event.runtimeRunId())) {
                throw new RuntimeEventRejectedException(
                        "Runtime event does not match its task, attempt, or run"
                );
            }
            if (events.insertIfAbsent(event)) {
                accepted += 1;
                attemptIds.add(event.attemptId());
                taskIds.add(event.taskId());
            }
        }

        for (UUID attemptId : attemptIds) {
            projector.reconcile(attemptId);
        }
        publishAfterCommit(taskIds);
        return new RuntimeEventIngestionResult(accepted, batch.events().size() - accepted);
    }

    private void publishAfterCommit(Set<UUID> taskIds) {
        Runnable publish = () -> taskIds.forEach(taskId -> {
            if (approvals != null) {
                try {
                    approvals.processPendingForTask(taskId);
                } catch (RuntimeException ignored) {
                    // The frozen pending row remains retryable and will eventually time out denied.
                }
            }
            streams.publishAvailable(taskId);
        });
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            publish.run();
            return;
        }
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                publish.run();
            }
        });
    }
}
