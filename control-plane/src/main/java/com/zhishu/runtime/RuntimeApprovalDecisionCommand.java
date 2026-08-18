package com.zhishu.runtime;

public record RuntimeApprovalDecisionCommand(
        String protocolVersion,
        String requestId,
        String idempotencyKey,
        String decision,
        String message,
        String decisionSource,
        String policy,
        String rule,
        String reason
) {
    public RuntimeApprovalDecisionCommand(
            String protocolVersion, String requestId, String idempotencyKey,
            String decision, String message
    ) {
        this(protocolVersion, requestId, idempotencyKey, decision, message,
                "MANUAL", "MANUAL", "manual-decision", message);
    }
}
