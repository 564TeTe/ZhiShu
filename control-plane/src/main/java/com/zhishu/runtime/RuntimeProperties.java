package com.zhishu.runtime;

import java.net.URI;
import java.time.Duration;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "zhishu.runtime")
public record RuntimeProperties(
        URI baseUrl,
        String token,
        Duration connectTimeout,
        Duration readTimeout
) {
}
