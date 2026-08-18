package com.zhishu.scheduler;

import java.util.UUID;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/internal/project-control/v1/projects/{projectId}/plans/{planId}/parallel-schedule-candidates")
public class SchedulerCandidatePairController {

    private final ParallelScheduleService schedules;

    public SchedulerCandidatePairController(ParallelScheduleService schedules) {
        this.schedules = schedules;
    }

    @GetMapping
    public SchedulerCandidatePairMatrixView get(
            @PathVariable UUID projectId,
            @PathVariable UUID planId,
            @RequestParam(defaultValue = "200") int limit
    ) {
        return schedules.candidatePairs(projectId, planId, limit);
    }
}
