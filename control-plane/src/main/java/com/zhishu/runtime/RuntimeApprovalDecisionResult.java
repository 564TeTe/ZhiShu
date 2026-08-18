package com.zhishu.runtime;

public record RuntimeApprovalDecisionResult(
        String runtimeRunId,
        String runtimeApprovalId,
        String decision
) {
}
