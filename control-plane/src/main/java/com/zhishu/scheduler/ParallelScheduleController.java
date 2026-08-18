package com.zhishu.scheduler;

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
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import com.zhishu.approval.ApprovalMode;
import com.zhishu.workorder.WorkOrderService;
import com.zhishu.workspace.WorkspaceProvisionerService;

@RestController
@RequestMapping("/internal/project-control/v1/projects/{projectId}/plans/{planId}/parallel-schedules")
public class ParallelScheduleController {

    private final ParallelScheduleService schedules;
    private final WorkspaceProvisionerService provisioner;
    private final WorkOrderService workOrders;

    public ParallelScheduleController(
            ParallelScheduleService schedules,
            WorkspaceProvisionerService provisioner,
            WorkOrderService workOrders
    ) {
        this.schedules = schedules;
        this.provisioner = provisioner;
        this.workOrders = workOrders;
    }

    @GetMapping
    public List<ParallelScheduleView> list(
            @PathVariable UUID projectId,
            @PathVariable UUID planId,
            @RequestParam(defaultValue = "50") int limit
    ) {
        return schedules.list(projectId, planId, limit);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public ParallelScheduleView create(
            @PathVariable UUID projectId,
            @PathVariable UUID planId,
            @RequestHeader("X-Zhishu-Actor") String actor,
            @Valid @RequestBody CreateRequest request
    ) {
        return schedules.create(
                projectId, planId, actor, request.clientRequestId(),
                request.baseStateRevision(), request.basePlanVersion(), request.nodeKeys(),
                request.physicalWorkspaceKind()
        );
    }

    @PostMapping("/{scheduleId}/confirm")
    public ParallelScheduleView confirm(
            @PathVariable UUID projectId,
            @PathVariable UUID planId,
            @PathVariable UUID scheduleId,
            @RequestHeader("X-Zhishu-Actor") String actor,
            @Valid @RequestBody DecisionRequest request
    ) {
        return schedules.confirm(projectId, planId, scheduleId, actor, request.clientRequestId());
    }

    @PostMapping("/{scheduleId}/reject")
    public ParallelScheduleView reject(
            @PathVariable UUID projectId,
            @PathVariable UUID planId,
            @PathVariable UUID scheduleId,
            @RequestHeader("X-Zhishu-Actor") String actor,
            @Valid @RequestBody RejectRequest request
    ) {
        return schedules.reject(
                projectId, planId, scheduleId, actor, request.clientRequestId(), request.reason()
        );
    }

    @PostMapping("/{scheduleId}/workspace-leases/{leaseId}/provision")
    public ParallelScheduleView provisionWorkspace(
            @PathVariable UUID projectId,
            @PathVariable UUID planId,
            @PathVariable UUID scheduleId,
            @PathVariable UUID leaseId,
            @RequestHeader("X-Zhishu-Actor") String actor,
            @Valid @RequestBody ProvisionRequest request
    ) {
        return provisioner.provision(
                projectId, scheduleId, leaseId, actor, request.clientRequestId()
        );
    }

    @PostMapping("/{scheduleId}/dispatch")
    @ResponseStatus(HttpStatus.CREATED)
    public WorkOrderService.ScheduleDispatchView dispatch(
            @PathVariable UUID projectId,
            @PathVariable UUID planId,
            @PathVariable UUID scheduleId,
            @RequestHeader("X-Zhishu-Actor") String actor,
            @Valid @RequestBody DispatchRequest request
    ) {
        return workOrders.claimScheduleAndDispatch(
                projectId,
                actor,
                new WorkOrderService.ScheduleDispatchCommand(
                        request.clientRequestId(), planId, scheduleId, ApprovalMode.MANUAL
                )
        );
    }

    public record CreateRequest(
            @NotBlank @Size(max = 160) String clientRequestId,
            long baseStateRevision,
            long basePlanVersion,
            @Size(min = 2, max = 2) List<@NotBlank String> nodeKeys,
            String physicalWorkspaceKind
    ) {
        public CreateRequest {
            nodeKeys = nodeKeys == null ? List.of() : List.copyOf(nodeKeys);
            physicalWorkspaceKind = physicalWorkspaceKind == null || physicalWorkspaceKind.isBlank()
                    ? "DIRECTORY_ONLY" : physicalWorkspaceKind.trim();
        }
    }

    public record DecisionRequest(@NotBlank @Size(max = 160) String clientRequestId) {
    }

    public record RejectRequest(
            @NotBlank @Size(max = 160) String clientRequestId,
            @NotBlank @Size(max = 1000) String reason
    ) {
    }

    public record ProvisionRequest(@NotBlank @Size(max = 160) String clientRequestId) {
    }

    public record DispatchRequest(@NotBlank @Size(max = 160) String clientRequestId) {
    }
}
