package com.zhishu.state;

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
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.fasterxml.jackson.databind.JsonNode;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

@RestController
@RequestMapping("/internal/project-control/v1/projects/{projectId}")
public class ProjectStateController {

    private final ProjectStateService states;
    private final StateStewardService steward;

    public ProjectStateController(ProjectStateService states, StateStewardService steward) {
        this.states = states;
        this.steward = steward;
    }

    @GetMapping("/state")
    public ProjectStateSnapshotView state(@PathVariable UUID projectId) {
        return states.getSnapshot(projectId);
    }

    @PostMapping("/state/initial-proposals")
    @ResponseStatus(HttpStatus.CREATED)
    public ProjectStateProposalView createInitialProposal(
            @PathVariable UUID projectId,
            @RequestHeader("X-Zhishu-Actor") String actor,
            @RequestBody JsonNode payload
    ) {
        return states.createInitialProposal(projectId, actor, payload);
    }

    @PostMapping("/state/proposals/{proposalId}/confirm")
    public ProjectChangeView confirmProposal(
            @PathVariable UUID projectId,
            @PathVariable UUID proposalId,
            @RequestHeader("X-Zhishu-Actor") String actor,
            @Valid @RequestBody ConfirmStateProposalRequest request
    ) {
        return states.confirmProposal(projectId, proposalId, actor, request.clientRequestId());
    }

    @PostMapping("/state/proposals/{proposalId}/reject")
    public ProjectChangeView rejectProposal(
            @PathVariable UUID projectId,
            @PathVariable UUID proposalId,
            @RequestHeader("X-Zhishu-Actor") String actor,
            @Valid @RequestBody RejectStateProposalRequest request
    ) {
        return states.rejectProposal(
                projectId, proposalId, actor, request.clientRequestId(), request.reason()
        );
    }

    @PostMapping("/state/steward/proposals")
    @ResponseStatus(HttpStatus.CREATED)
    public ProjectStateProposalView createStewardProposal(
            @PathVariable UUID projectId,
            @RequestHeader("X-Zhishu-Actor") String actor,
            @RequestBody JsonNode report
    ) {
        return steward.createProposal(projectId, actor, report);
    }

    @PostMapping("/state/steward/reports/{reportId}/proposal")
    @ResponseStatus(HttpStatus.CREATED)
    public ProjectStateProposalView createStewardProposalFromReport(
            @PathVariable UUID projectId,
            @PathVariable UUID reportId,
            @RequestHeader("X-Zhishu-Actor") String actor
    ) {
        return steward.createProposalFromReport(projectId, reportId, actor);
    }

    @GetMapping("/state/proposals")
    public List<ProjectStateProposalView> proposals(
            @PathVariable UUID projectId,
            @RequestParam(required = false) String proposalType,
            @RequestParam(defaultValue = "50") int limit
    ) {
        return states.listProposals(projectId, proposalType, limit);
    }

    @GetMapping("/changes")
    public Map<String, Object> changes(
            @PathVariable UUID projectId,
            @RequestParam(defaultValue = "0") long afterRevision,
            @RequestParam(defaultValue = "50") int limit
    ) {
        List<ProjectChangeView> changes = states.listChanges(projectId, afterRevision, limit);
        long latestRevision = changes.stream().mapToLong(ProjectChangeView::afterRevision)
                .max().orElse(afterRevision);
        return Map.of(
                "schemaVersion", "1.0",
                "projectId", projectId,
                "afterRevision", afterRevision,
                "latestRevision", latestRevision,
                "changes", changes
        );
    }

    @PostMapping("/contexts")
    @ResponseStatus(HttpStatus.CREATED)
    public ContextPackageView generateContext(
            @PathVariable UUID projectId,
            @Valid @RequestBody GenerateContextRequest request
    ) {
        return states.generateContext(projectId, request.packageType());
    }

    @GetMapping("/contexts/{packageId}")
    public ContextPackageView archivedContext(
            @PathVariable UUID projectId,
            @PathVariable UUID packageId
    ) {
        return states.getContext(projectId, packageId)
                .orElseThrow(() -> new ProjectStateConflictException("Context Package was not found."));
    }

    public record ConfirmStateProposalRequest(
            @NotBlank @Size(max = 120) String clientRequestId
    ) {
    }

    public record RejectStateProposalRequest(
            @NotBlank @Size(max = 120) String clientRequestId,
            @NotBlank @Size(max = 1000) String reason
    ) {
    }

    public record GenerateContextRequest(
            @NotNull String packageType
    ) {
    }
}
