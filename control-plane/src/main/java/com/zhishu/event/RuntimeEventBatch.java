package com.zhishu.event;

import java.util.List;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

public record RuntimeEventBatch(
        @NotBlank @Pattern(regexp = "1\\.0") String protocolVersion,
        @NotEmpty List<@Valid RuntimeEvent> events
) {
}
