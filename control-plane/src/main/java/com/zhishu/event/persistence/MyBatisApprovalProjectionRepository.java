package com.zhishu.event.persistence;

import java.util.Map;
import java.util.UUID;

import org.springframework.stereotype.Repository;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.zhishu.event.ApprovalProjectionRepository;
import com.zhishu.event.StoredTaskEvent;

@Repository
public class MyBatisApprovalProjectionRepository implements ApprovalProjectionRepository {

    private final ApprovalProjectionMapper mapper;
    private final ObjectMapper objectMapper;

    public MyBatisApprovalProjectionRepository(ApprovalProjectionMapper mapper, ObjectMapper objectMapper) {
        this.mapper = mapper;
        this.objectMapper = objectMapper;
    }

    @Override
    public void open(StoredTaskEvent event) {
        Map<String, Object> payload = event.payload();
        mapper.open(
                UUID.randomUUID(),
                event.taskId(),
                event.attemptId(),
                requiredString(payload, "runtimeApprovalId"),
                requiredString(payload, "toolName"),
                writeJson(payload.get("toolInput")),
                String.valueOf(payload.getOrDefault("riskLevel", "MEDIUM"))
        );
    }

    @Override
    public void resolve(StoredTaskEvent event) {
        Map<String, Object> payload = event.payload();
        String runtimeApprovalId = requiredString(payload, "runtimeApprovalId");
        String decision = String.valueOf(payload.getOrDefault("decision", "EXPIRED"));
        String policy = String.valueOf(payload.getOrDefault("policy", "UNKNOWN"));
        String rule = String.valueOf(payload.getOrDefault("rule", "runtime-resolution"));
        String reason = String.valueOf(payload.getOrDefault("reason", "Runtime resolved approval"));
        mapper.resolve(
                event.attemptId(),
                runtimeApprovalId,
                decision,
                String.valueOf(payload.getOrDefault("decisionSource", "RUNTIME")),
                policy,
                rule,
                reason
        );
        mapper.insertRuntimeAudit(UUID.randomUUID(), event.attemptId(), runtimeApprovalId,
                decision, policy, rule, reason);
    }

    private String requiredString(Map<String, Object> payload, String key) {
        Object value = payload.get(key);
        if (!(value instanceof String text) || text.isBlank()) {
            throw new IllegalArgumentException("Runtime approval payload requires " + key);
        }
        return text;
    }

    private String writeJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value == null ? Map.of() : value);
        } catch (JsonProcessingException error) {
            throw new IllegalArgumentException("Approval tool input cannot be serialized", error);
        }
    }
}
