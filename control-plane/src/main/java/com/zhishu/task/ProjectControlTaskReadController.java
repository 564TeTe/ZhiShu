package com.zhishu.task;

import java.util.List;
import java.util.UUID;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/internal/project-control/v1/tasks")
public class ProjectControlTaskReadController {

    private final TaskApplicationService tasks;
    private final TaskFollowUpService followUps;

    public ProjectControlTaskReadController(TaskApplicationService tasks, TaskFollowUpService followUps) {
        this.tasks = tasks;
        this.followUps = followUps;
    }

    @GetMapping
    public List<TaskController.TaskResponse> list(
            @RequestParam(required = false) UUID projectId,
            @RequestParam(defaultValue = "100") int limit
    ) {
        return tasks.list(projectId, limit).stream().map(TaskController.TaskResponse::from).toList();
    }

    @GetMapping("/{taskId}")
    public TaskController.TaskResponse get(@PathVariable UUID taskId) {
        return TaskController.TaskResponse.from(tasks.get(taskId));
    }

    @GetMapping("/{taskId}/attempts")
    public List<TaskAttemptView> attempts(@PathVariable UUID taskId) {
        return tasks.attempts(taskId);
    }

    @GetMapping("/{taskId}/follow-ups")
    public List<TaskFollowUpView> followUps(@PathVariable UUID taskId) {
        return followUps.list(taskId);
    }
}
