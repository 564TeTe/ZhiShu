package com.zhishu.project;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "zhishu.project-control")
public record ProjectControlProperties(String token) {
}
