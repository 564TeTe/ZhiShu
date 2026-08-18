package com.zhishu.event;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

public record RuntimeEvent(
        @NotBlank @Pattern(regexp = "1\\.0") String protocolVersion,
        @NotBlank String eventId,
        @NotNull UUID taskId,
        @NotNull UUID attemptId,
        @NotBlank String runtimeRunId,
        @Min(1) long sequenceNo,
        @NotNull Instant occurredAt,
        @NotNull RuntimeEventType type,
        @NotNull Map<String, Object> payload
) {
}
