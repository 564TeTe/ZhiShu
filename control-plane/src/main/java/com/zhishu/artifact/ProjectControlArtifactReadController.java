package com.zhishu.artifact;

import java.util.List;
import java.util.UUID;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/internal/project-control/v1/tasks/{taskId}/artifacts")
public class ProjectControlArtifactReadController {

    private final TaskArtifactService artifacts;

    public ProjectControlArtifactReadController(TaskArtifactService artifacts) {
        this.artifacts = artifacts;
    }

    @GetMapping
    public List<TaskArtifactView> list(@PathVariable UUID taskId) {
        return artifacts.findByTaskId(taskId);
    }
}
