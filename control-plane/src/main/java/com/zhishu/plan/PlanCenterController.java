package com.zhishu.plan;

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
import jakarta.validation.constraints.NotBlank;

@RestController
@RequestMapping("/internal/project-control/v1/projects/{projectId}/plans")
public class PlanCenterController {

    private final PlanCenterService plans;

    public PlanCenterController(PlanCenterService plans) {
        this.plans = plans;
    }

    @GetMapping
    public List<Map<String, Object>> plans(@PathVariable UUID projectId) {
        return plans.listPlans(projectId);
    }

    @GetMapping("/{planId}")
    public Map<String, Object> plan(@PathVariable UUID projectId, @PathVariable UUID planId) {
        return plans.getPlan(projectId, planId);
    }

    @GetMapping("/proposals")
    public List<Map<String, Object>> proposals(@PathVariable UUID projectId) {
        return plans.listProposals(projectId);
    }

    @PostMapping("/proposals")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> createProposal(
            @PathVariable UUID projectId,
            @RequestHeader("X-Zhishu-Actor") String actor,
            @RequestBody JsonNode payload
    ) {
        return plans.createProposal(projectId, actor, payload);
    }

    @PostMapping("/proposals/{proposalId}/publish")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> publish(
            @PathVariable UUID projectId,
            @PathVariable UUID proposalId,
            @RequestHeader("X-Zhishu-Actor") String actor,
            @RequestBody PublishRequest request
    ) {
        return plans.publish(projectId, proposalId, actor, request.approvedNodeKeys());
    }

    @PostMapping("/proposals/{proposalId}/reject")
    public Map<String, Object> reject(
            @PathVariable UUID projectId,
            @PathVariable UUID proposalId,
            @RequestHeader("X-Zhishu-Actor") String actor,
            @Valid @RequestBody RejectRequest request
    ) {
        return plans.reject(projectId, proposalId, actor, request.reason());
    }

    public record PublishRequest(List<String> approvedNodeKeys) {
        public PublishRequest {
            approvedNodeKeys = approvedNodeKeys == null ? List.of() : List.copyOf(approvedNodeKeys);
        }
    }

    public record RejectRequest(@NotBlank String reason) {
    }
}
