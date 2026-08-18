package com.zhishu.runtime;

import java.time.Duration;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "zhishu.runtime.lease")
public record RuntimeLeaseProperties(Duration duration, Duration unknownGrace) {

    public RuntimeLeaseProperties {
        if (duration == null || duration.isZero() || duration.isNegative()) {
            throw new IllegalArgumentException("Runtime lease duration must be positive");
        }
        if (unknownGrace == null || unknownGrace.isZero() || unknownGrace.isNegative()) {
            throw new IllegalArgumentException("Runtime UNKNOWN grace must be positive");
        }
    }
}
