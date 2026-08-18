package com.zhishu.scheduler;

import java.util.UUID;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/internal/project-control/v1/projects/{projectId}/plans/{planId}/capability-matrix")
public class SchedulerCapabilityMatrixController {

    private final ParallelScheduleService schedules;

    public SchedulerCapabilityMatrixController(ParallelScheduleService schedules) {
        this.schedules = schedules;
    }

    @GetMapping
    public SchedulerCapabilityMatrixView get(
            @PathVariable UUID projectId,
            @PathVariable UUID planId
    ) {
        return schedules.capabilityMatrix(projectId, planId);
    }
}
