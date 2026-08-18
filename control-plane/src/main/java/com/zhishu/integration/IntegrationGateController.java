package com.zhishu.integration;

import java.util.List;
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

import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

@RestController
@RequestMapping("/internal/project-control/v1/projects/{projectId}/plans/{planId}/integration-gates")
public class IntegrationGateController {

    private final IntegrationGateService gates;
    private final IntegrationExecutionService executions;
    private final IntegrationAgentService agents;

    public IntegrationGateController(
            IntegrationGateService gates,
            IntegrationExecutionService executions,
            IntegrationAgentService agents
    ) {
        this.gates = gates;
        this.executions = executions;
        this.agents = agents;
    }

    @GetMapping
    public List<IntegrationGateView> list(
            @PathVariable UUID projectId,
            @PathVariable UUID planId,
            @RequestParam(defaultValue = "50") int limit
    ) {
        return gates.list(projectId, planId, limit);
    }

    @GetMapping("/{gateId}")
    public IntegrationGateView get(@PathVariable UUID projectId, @PathVariable UUID planId, @PathVariable UUID gateId) {
        return gates.get(projectId, planId, gateId);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public IntegrationGateView create(
            @PathVariable UUID projectId,
            @PathVariable UUID planId,
            @RequestHeader("X-Zhishu-Actor") String actor,
            @Valid @RequestBody CreateRequest request
    ) {
        return gates.create(projectId, planId, request.scheduleId(), actor, request.clientRequestId(),
                request.baseStateRevision(), request.basePlanVersion(), request.evidenceReferenceIds());
    }

    @PostMapping("/{gateId}/confirm")
    public IntegrationGateView confirm(
            @PathVariable UUID projectId,
            @PathVariable UUID planId,
            @PathVariable UUID gateId,
            @RequestHeader("X-Zhishu-Actor") String actor,
            @Valid @RequestBody DecisionRequest request
    ) {
        return gates.confirm(projectId, planId, gateId, actor, request.clientRequestId());
    }

    @PostMapping("/{gateId}/reject")
    public IntegrationGateView reject(
            @PathVariable UUID projectId,
            @PathVariable UUID planId,
            @PathVariable UUID gateId,
            @RequestHeader("X-Zhishu-Actor") String actor,
            @Valid @RequestBody RejectRequest request
    ) {
        return gates.reject(projectId, planId, gateId, actor, request.clientRequestId(), request.reason());
    }

    @PostMapping("/{gateId}/executions")
    @ResponseStatus(HttpStatus.CREATED)
    public IntegrationExecutionView execute(
            @PathVariable UUID projectId,
            @PathVariable UUID planId,
            @PathVariable UUID gateId,
            @RequestHeader("X-Zhishu-Actor") String actor,
            @Valid @RequestBody DecisionRequest request
    ) {
        return executions.execute(projectId, planId, gateId, actor, request.clientRequestId());
    }

    @GetMapping("/{gateId}/executions/{runId}")
    public IntegrationExecutionView execution(
            @PathVariable UUID projectId,
            @PathVariable UUID planId,
            @PathVariable UUID gateId,
            @PathVariable UUID runId
    ) {
        return executions.get(projectId, planId, gateId, runId, false);
    }

    @PostMapping("/{gateId}/executions/{runId}/finalize")
    public IntegrationExecutionView finalizeCandidate(
            @PathVariable UUID projectId,
            @PathVariable UUID planId,
            @PathVariable UUID gateId,
            @PathVariable UUID runId,
            @RequestHeader("X-Zhishu-Actor") String actor,
            @Valid @RequestBody FinalizeRequest request
    ) {
        return executions.finalizeCandidate(
                projectId, planId, gateId, runId, actor,
                request.clientRequestId(), request.candidateCommit()
        );
    }

    @PostMapping("/{gateId}/executions/{runId}/agent")
    @ResponseStatus(HttpStatus.CREATED)
    public IntegrationAgentRunView startAgent(
            @PathVariable UUID projectId,
            @PathVariable UUID planId,
            @PathVariable UUID gateId,
            @PathVariable UUID runId,
            @RequestHeader("X-Zhishu-Actor") String actor,
            @Valid @RequestBody AgentRequest request
    ) {
        return agents.start(
                projectId, planId, gateId, runId, actor, request.clientRequestId(), request.profileId()
        );
    }

    public record AgentRequest(
            @NotBlank @Size(max = 160) String clientRequestId,
            UUID profileId
    ) {
    }

    public record FinalizeRequest(
            @NotBlank @Size(max = 160) String clientRequestId,
            @NotBlank @Size(min = 40, max = 64) String candidateCommit
    ) {
    }

    public record CreateRequest(
            @NotBlank @Size(max = 160) String clientRequestId,
            @NotNull UUID scheduleId,
            @Min(0) long baseStateRevision,
            @Min(1) long basePlanVersion,
            @Size(max = 100) List<UUID> evidenceReferenceIds
    ) {
        public CreateRequest {
            evidenceReferenceIds = evidenceReferenceIds == null ? List.of() : List.copyOf(evidenceReferenceIds);
        }
    }

    public record DecisionRequest(@NotBlank @Size(max = 160) String clientRequestId) {
    }

    public record RejectRequest(
            @NotBlank @Size(max = 160) String clientRequestId,
            @NotBlank @Size(max = 1000) String reason
    ) {
    }
}
