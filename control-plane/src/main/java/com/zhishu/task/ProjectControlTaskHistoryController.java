package com.zhishu.task;

import java.util.List;
import java.util.UUID;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/internal/project-control/v1/projects/{projectId}/tasks")
public class ProjectControlTaskHistoryController {

    private final TaskApplicationService tasks;

    public ProjectControlTaskHistoryController(TaskApplicationService tasks) {
        this.tasks = tasks;
    }

    @GetMapping
    public TaskHistoryPageResponse list(
            @PathVariable UUID projectId,
            @RequestParam(defaultValue = "ACTIVE") TaskArchiveScope archive,
            @RequestParam(required = false) AttemptStatus status,
            @RequestParam(required = false) ResolutionStatus resolutionStatus,
            @RequestParam(required = false) String search,
            @RequestParam(required = false) String cursor,
            @RequestParam(defaultValue = "25") int limit
    ) {
        TaskSearchResult result = tasks.search(
                projectId, archive, status, resolutionStatus, search, cursor, limit
        );
        return new TaskHistoryPageResponse(
                result.items().stream().map(TaskHistoryResponse::from).toList(),
                result.nextCursor(),
                result.hasMore()
        );
    }

    @GetMapping("/{taskId}")
    public TaskHistoryResponse get(@PathVariable UUID projectId, @PathVariable UUID taskId) {
        return TaskHistoryResponse.from(tasks.getForProject(projectId, taskId));
    }

    @GetMapping("/{taskId}/attempts")
    public List<TaskAttemptView> attempts(@PathVariable UUID projectId, @PathVariable UUID taskId) {
        return tasks.attemptsForProject(projectId, taskId);
    }

    public record TaskHistoryPageResponse(
            List<TaskHistoryResponse> items,
            String nextCursor,
            boolean hasMore
    ) {
    }
}
