package com.zhishu.brain;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.fasterxml.jackson.databind.JsonNode;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

@RestController
@RequestMapping("/internal/project-control/v1/projects/{projectId}/brain")
public class BrainCollaborationController {

    private final BrainCollaborationService brain;

    public BrainCollaborationController(BrainCollaborationService brain) {
        this.brain = brain;
    }

    @PostMapping("/threads")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> createThread(
            @PathVariable UUID projectId,
            @RequestHeader("X-Zhishu-Actor") String actor,
            @Valid @RequestBody CreateThreadRequest request
    ) {
        return brain.createThread(projectId, request.title(), actor);
    }

    @GetMapping("/threads")
    public List<Map<String, Object>> threads(@PathVariable UUID projectId) {
        return brain.listThreads(projectId);
    }

    @GetMapping("/threads/{threadId}/messages")
    public List<Map<String, Object>> messages(@PathVariable UUID projectId, @PathVariable UUID threadId) {
        return brain.listMessages(projectId, threadId);
    }

    @PostMapping("/threads/{threadId}/runs")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> recordRun(
            @PathVariable UUID projectId,
            @PathVariable UUID threadId,
            @RequestHeader("X-Zhishu-Actor") String actor,
            @Valid @RequestBody RecordRunRequest request
    ) {
        return brain.recordRun(projectId, threadId, actor, new BrainCollaborationService.RunRecord(
                request.contextPackageId(), request.provider(), request.model(), request.permissions(),
                request.compositeContextVersion(), request.inputTokens(), request.outputTokens(),
                request.userMessage(), request.brainMessage(), request.citations(), request.generatedProposal()
        ));
    }

    public record CreateThreadRequest(@NotBlank String title) {
    }

    public record RecordRunRequest(
            @NotNull UUID contextPackageId,
            @NotBlank String provider,
            @NotBlank String model,
            @NotNull JsonNode permissions,
            @NotNull JsonNode compositeContextVersion,
            @Min(0) long inputTokens,
            @Min(0) long outputTokens,
            @NotBlank String userMessage,
            @NotBlank String brainMessage,
            @NotNull JsonNode citations,
            JsonNode generatedProposal
    ) {
    }
}
