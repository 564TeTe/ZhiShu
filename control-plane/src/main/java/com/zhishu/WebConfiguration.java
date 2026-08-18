package com.zhishu;

import java.util.List;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class WebConfiguration implements WebMvcConfigurer {

    private final List<String> allowedOrigins;

    public WebConfiguration(
            @Value("${zhishu.web.allowed-origins:http://127.0.0.1:3001,http://localhost:3001,http://127.0.0.1:5173,http://localhost:5173}")
            List<String> allowedOrigins
    ) {
        this.allowedOrigins = List.copyOf(allowedOrigins);
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/v1/**")
                .allowedOrigins(allowedOrigins.toArray(String[]::new))
                .allowedMethods("GET", "POST", "PUT", "DELETE", "OPTIONS")
                .allowedHeaders("Content-Type", "Last-Event-ID")
                .exposedHeaders("Content-Type")
                .allowCredentials(false);
    }
}
