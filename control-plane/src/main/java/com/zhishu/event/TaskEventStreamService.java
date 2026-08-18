package com.zhishu.event;

import java.io.IOException;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;

import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import com.zhishu.task.TaskNotFoundException;
import com.zhishu.task.TaskRepository;

@Service
public class TaskEventStreamService {

    private static final long STREAM_TIMEOUT_MILLIS = 30 * 60 * 1000L;
    private static final int PAGE_SIZE = 200;

    private final TaskEventRepository events;
    private final TaskRepository tasks;
    private final ConcurrentHashMap<UUID, CopyOnWriteArrayList<Subscription>> subscriptions =
            new ConcurrentHashMap<>();

    public TaskEventStreamService(TaskEventRepository events, TaskRepository tasks) {
        this.events = events;
        this.tasks = tasks;
    }

    public SseEmitter subscribe(UUID taskId, long lastEventId) {
        if (tasks.findById(taskId).isEmpty()) {
            throw new TaskNotFoundException(taskId);
        }

        SseEmitter emitter = new SseEmitter(STREAM_TIMEOUT_MILLIS);
        Subscription subscription = new Subscription(emitter, lastEventId);
        CopyOnWriteArrayList<Subscription> taskSubscriptions = subscriptions.computeIfAbsent(
                taskId,
                ignored -> new CopyOnWriteArrayList<>()
        );
        taskSubscriptions.add(subscription);

        Runnable remove = () -> remove(taskId, subscription);
        emitter.onCompletion(remove);
        emitter.onTimeout(remove);
        emitter.onError(ignored -> remove.run());
        publishAvailable(taskId);
        return emitter;
    }

    public void publishAvailable(UUID taskId) {
        List<Subscription> taskSubscriptions = subscriptions.get(taskId);
        if (taskSubscriptions == null) {
            return;
        }
        for (Subscription subscription : taskSubscriptions) {
            try {
                subscription.publish(events, taskId);
            } catch (IOException error) {
                remove(taskId, subscription);
                subscription.emitter.completeWithError(error);
            }
        }
    }

    private void remove(UUID taskId, Subscription subscription) {
        CopyOnWriteArrayList<Subscription> taskSubscriptions = subscriptions.get(taskId);
        if (taskSubscriptions == null) {
            return;
        }
        taskSubscriptions.remove(subscription);
        if (taskSubscriptions.isEmpty()) {
            subscriptions.remove(taskId, taskSubscriptions);
        }
    }

    private static final class Subscription {
        private final SseEmitter emitter;
        private long lastSentId;

        private Subscription(SseEmitter emitter, long lastSentId) {
            this.emitter = emitter;
            this.lastSentId = lastSentId;
        }

        private synchronized void publish(TaskEventRepository events, UUID taskId) throws IOException {
            while (true) {
                List<StoredTaskEvent> page = events.findAfter(taskId, lastSentId, PAGE_SIZE);
                for (StoredTaskEvent event : page) {
                    if (event.id() <= lastSentId) {
                        continue;
                    }
                    emitter.send(SseEmitter.event()
                            .id(Long.toString(event.id()))
                            .name(event.eventType().name())
                            .data(event));
                    lastSentId = event.id();
                }
                if (page.size() < PAGE_SIZE) {
                    return;
                }
            }
        }
    }
}
