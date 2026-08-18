package com.zhishu.event;

import static org.assertj.core.api.Assertions.assertThat;
import java.time.Clock;
import java.time.Instant;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import org.junit.jupiter.api.Test;

class RuntimeEventIngestionServiceTest {

    @Test
    void acceptsOnceAndTreatsReplayAsDuplicate() {
        UUID taskId = UUID.randomUUID();
        UUID attemptId = UUID.randomUUID();
        RuntimeEvent event = new RuntimeEvent(
                "1.0",
                "event-1",
                taskId,
                attemptId,
                "run-1",
                1,
                Instant.parse("2026-08-11T08:00:00Z"),
                RuntimeEventType.RUN_STARTED,
                Map.of()
        );
        DeduplicatingEvents events = new DeduplicatingEvents();
        RecordingProjector projector = new RecordingProjector();
        RecordingStreams streams = new RecordingStreams();
        RuntimeEventIngestionService service = new RuntimeEventIngestionService(events, projector, streams);
        RuntimeEventBatch batch = new RuntimeEventBatch("1.0", List.of(event));

        RuntimeEventIngestionResult first = service.ingest(batch);
        RuntimeEventIngestionResult replay = service.ingest(batch);

        assertThat(first).isEqualTo(new RuntimeEventIngestionResult(1, 0));
        assertThat(replay).isEqualTo(new RuntimeEventIngestionResult(0, 1));
        assertThat(projector.calls).isEqualTo(1);
        assertThat(projector.lastAttemptId).isEqualTo(attemptId);
        assertThat(streams.calls).isEqualTo(1);
        assertThat(streams.lastTaskId).isEqualTo(taskId);
    }

    private static final class DeduplicatingEvents implements TaskEventRepository {
        private final Set<String> eventIds = new HashSet<>();

        @Override public boolean attemptMatches(UUID taskId, UUID attemptId, String runtimeRunId) { return true; }
        @Override public boolean insertIfAbsent(RuntimeEvent event) { return eventIds.add(event.eventId()); }
        @Override public List<StoredTaskEvent> findUnprojected(UUID attemptId) { return List.of(); }
        @Override public void markProjected(long eventDatabaseId, Instant projectedAt) { }
        @Override public List<StoredTaskEvent> findAfter(UUID taskId, long afterId, int limit) { return List.of(); }
    }

    private static final class RecordingProjector extends RuntimeEventProjector {
        private int calls;
        private UUID lastAttemptId;

        private RecordingProjector() {
            super(null, null, null, null, null, null, Clock.systemUTC());
        }

        @Override
        public void reconcile(UUID attemptId) {
            calls += 1;
            lastAttemptId = attemptId;
        }
    }

    private static final class RecordingStreams extends TaskEventStreamService {
        private int calls;
        private UUID lastTaskId;

        private RecordingStreams() {
            super(null, null);
        }

        @Override
        public void publishAvailable(UUID taskId) {
            calls += 1;
            lastTaskId = taskId;
        }
    }
}
