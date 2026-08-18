package com.zhishu.runtime;

public record RuntimeCancelCommand(
        String protocolVersion,
        String requestId,
        String idempotencyKey
) {
}
