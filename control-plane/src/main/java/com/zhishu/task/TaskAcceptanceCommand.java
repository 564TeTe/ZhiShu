package com.zhishu.task;

import java.util.UUID;

public record TaskAcceptanceCommand(
        UUID attemptId,
        String clientRequestId,
        String actor,
        AcceptanceDecision decision,
        String reason
) {
}
