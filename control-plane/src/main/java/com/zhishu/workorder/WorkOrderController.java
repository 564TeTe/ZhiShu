package com.zhishu.workorder;

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

import com.zhishu.approval.ApprovalMode;
import com.zhishu.brain.BrainCollaborationService;
import com.fasterxml.jackson.databind.JsonNode;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

@RestController
@RequestMapping("/internal/project-control/v1/projects/{projectId}/work-orders")
public class WorkOrderController {

    private final WorkOrderService workOrders;

    public WorkOrderController(WorkOrderService workOrders) {
        this.workOrders = workOrders;
    }

    @GetMapping
    public List<Map<String, Object>> list(
            @PathVariable UUID projectId,
            @RequestParam(required = false) UUID planId,
            @RequestParam(required = false) String nodeKey
    ) {
        return workOrders.list(projectId, planId, nodeKey);
    }

    @GetMapping("/{workOrderId}")
    public Map<String, Object> get(@PathVariable UUID projectId, @PathVariable UUID workOrderId) {
        return workOrders.get(projectId, workOrderId);
    }

    @PostMapping("/claims")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> claim(
            @PathVariable UUID projectId,
            @RequestHeader("X-Zhishu-Actor") String actor,
            @Valid @RequestBody ClaimRequest request
    ) {
        return workOrders.claimAndDispatch(projectId, actor, new WorkOrderService.ClaimCommand(
                request.clientRequestId(), request.planId(), request.nodeKey(),
                request.profileId(), request.approvalMode()
        ));
    }

    @PostMapping("/{workOrderId}/verifications")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> verify(
            @PathVariable UUID projectId,
            @PathVariable UUID workOrderId,
            @RequestHeader("X-Zhishu-Actor") String actor,
            @Valid @RequestBody VerificationRequest request
    ) {
        return workOrders.verify(projectId, workOrderId, actor, request.reportId(),
                request.decision(), request.reason());
    }

    @PostMapping("/{workOrderId}/brain-handoff")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> brainHandoff(
            @PathVariable UUID projectId,
            @PathVariable UUID workOrderId,
            @RequestHeader("X-Zhishu-Actor") String actor,
            @Valid @RequestBody BrainHandoffRequest request
    ) {
        return workOrders.recordBrainHandoff(
                projectId, workOrderId, request.verificationId(), request.threadId(), actor,
                new BrainCollaborationService.RunRecord(
                        request.contextPackageId(), request.provider(), request.model(), request.permissions(),
                        request.compositeContextVersion(), request.inputTokens(), request.outputTokens(),
                        request.userMessage(), request.brainMessage(), request.citations(), request.generatedProposal()
                )
        );
    }

    public record ClaimRequest(
            @NotBlank String clientRequestId,
            @NotNull UUID planId,
            @NotBlank String nodeKey,
            @NotNull UUID profileId,
            ApprovalMode approvalMode
    ) {
    }

    public record VerificationRequest(
            @NotNull UUID reportId,
            @NotBlank String decision,
            @NotBlank String reason
    ) {
    }

    public record BrainHandoffRequest(
            @NotNull UUID verificationId,
            @NotNull UUID threadId,
            @NotNull UUID contextPackageId,
            @NotBlank String provider,
            @NotBlank String model,
            @NotNull JsonNode permissions,
            @NotNull JsonNode compositeContextVersion,
            long inputTokens,
            long outputTokens,
            @NotBlank String userMessage,
            @NotBlank String brainMessage,
            @NotNull JsonNode citations,
            JsonNode generatedProposal
    ) {
    }
}
