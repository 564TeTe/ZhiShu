package com.zhishu.projectactivity;

import java.util.UUID;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/internal/project-control/v1/projects/{projectId}")
public class ProjectActivityController {

    private final ProjectActivityService activity;

    public ProjectActivityController(ProjectActivityService activity) {
        this.activity = activity;
    }

    @GetMapping("/activity")
    public ProjectActivityFeed activity(
            @PathVariable UUID projectId,
            @RequestParam(required = false) Long after,
            @RequestParam(defaultValue = "100") int limit
    ) {
        return activity.read(projectId, after, limit);
    }

    @GetMapping("/metrics")
    public ProjectMetricsView metrics(
            @PathVariable UUID projectId,
            @RequestParam(defaultValue = "168") int windowHours
    ) {
        return activity.metrics(projectId, windowHours);
    }
}
