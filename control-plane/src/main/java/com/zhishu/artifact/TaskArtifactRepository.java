package com.zhishu.artifact;

import java.util.List;
import java.util.UUID;

public interface TaskArtifactRepository {

    List<TaskArtifactView> findByTaskId(UUID taskId);

    List<TaskArtifactView> findByAttemptId(UUID attemptId);
}
