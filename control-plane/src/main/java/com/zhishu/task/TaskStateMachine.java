package com.zhishu.task;

import java.util.EnumMap;
import java.util.EnumSet;
import java.util.Map;
import java.util.Set;

import org.springframework.stereotype.Component;

@Component
public class TaskStateMachine {

    private static final Map<AttemptStatus, Set<AttemptStatus>> ALLOWED_TRANSITIONS = buildTransitions();

    private static Map<AttemptStatus, Set<AttemptStatus>> buildTransitions() {
        Map<AttemptStatus, Set<AttemptStatus>> transitions = new EnumMap<>(AttemptStatus.class);
        transitions.put(AttemptStatus.PENDING, EnumSet.of(AttemptStatus.STARTING, AttemptStatus.FAILED));
        transitions.put(AttemptStatus.STARTING,
                EnumSet.of(AttemptStatus.RUNNING, AttemptStatus.CANCELLING, AttemptStatus.FAILED, AttemptStatus.LOST));
        transitions.put(AttemptStatus.RUNNING,
                EnumSet.of(AttemptStatus.WAITING_APPROVAL, AttemptStatus.CANCELLING,
                        AttemptStatus.SUCCEEDED, AttemptStatus.FAILED, AttemptStatus.LOST));
        transitions.put(AttemptStatus.WAITING_APPROVAL,
                EnumSet.of(AttemptStatus.RUNNING, AttemptStatus.CANCELLING, AttemptStatus.FAILED, AttemptStatus.LOST));
        transitions.put(AttemptStatus.CANCELLING,
                EnumSet.of(AttemptStatus.ABORTED, AttemptStatus.FAILED, AttemptStatus.LOST));
        transitions.put(AttemptStatus.SUCCEEDED, EnumSet.noneOf(AttemptStatus.class));
        transitions.put(AttemptStatus.FAILED, EnumSet.noneOf(AttemptStatus.class));
        transitions.put(AttemptStatus.LOST, EnumSet.noneOf(AttemptStatus.class));
        transitions.put(AttemptStatus.ABORTED, EnumSet.noneOf(AttemptStatus.class));
        return Map.copyOf(transitions);
    }

    public void requireTransition(AttemptStatus current, AttemptStatus target) {
        if (!ALLOWED_TRANSITIONS.getOrDefault(current, Set.of()).contains(target)) {
            throw new InvalidTaskStateException(current, target);
        }
    }

    public boolean canTransition(AttemptStatus current, AttemptStatus target) {
        return ALLOWED_TRANSITIONS.getOrDefault(current, Set.of()).contains(target);
    }
}
