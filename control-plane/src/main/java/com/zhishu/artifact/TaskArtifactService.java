package com.zhishu.artifact;

import java.util.List;
import java.util.UUID;

import org.springframework.stereotype.Service;

@Service
public class TaskArtifactService {

    private final TaskArtifactRepository artifacts;

    public TaskArtifactService(TaskArtifactRepository artifacts) {
        this.artifacts = artifacts;
    }

    public List<TaskArtifactView> findByTaskId(UUID taskId) {
        return artifacts.findByTaskId(taskId);
    }

    public List<TaskArtifactView> findByAttemptId(UUID attemptId) {
        return artifacts.findByAttemptId(attemptId);
    }
}
