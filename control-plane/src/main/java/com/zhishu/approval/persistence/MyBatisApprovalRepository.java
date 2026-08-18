package com.zhishu.approval.persistence;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.springframework.stereotype.Repository;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.zhishu.approval.ApprovalDecision;
import com.zhishu.approval.ApprovalRepository;
import com.zhishu.approval.ApprovalView;
import com.zhishu.approval.ApprovalPolicySnapshot;
import com.zhishu.task.AttemptStatus;

@Repository
public class MyBatisApprovalRepository implements ApprovalRepository {

    private static final TypeReference<Map<String, Object>> TOOL_INPUT_TYPE = new TypeReference<>() { };

    private final ApprovalMapper mapper;
    private final ObjectMapper objectMapper;

    public MyBatisApprovalRepository(ApprovalMapper mapper, ObjectMapper objectMapper) {
        this.mapper = mapper;
        this.objectMapper = objectMapper;
    }

    @Override
    public Optional<ApprovalView> findById(UUID approvalId) {
        return Optional.ofNullable(mapper.findById(approvalId)).map(this::toView);
    }

    @Override
    public List<ApprovalView> findPendingByTask(UUID taskId) {
        return mapper.findPendingByTask(taskId).stream().map(this::toView).toList();
    }

    @Override
    public boolean prepareDecision(UUID approvalId, ApprovalDecision decision) {
        return mapper.prepareDecision(approvalId, preparingStatus(decision)) == 1;
    }

    @Override
    public boolean prepareDecision(UUID approvalId, ApprovalDecision decision, String source) {
        if ("TIMEOUT".equals(source)) return mapper.prepareExpiry(approvalId) == 1;
        return mapper.prepareStatus(approvalId, preparingStatus(decision, source)) == 1;
    }

    @Override
    public void finalizeDecision(UUID approvalId, ApprovalDecision decision) {
        finalizeDecision(approvalId, decision, decision.name(), "user", "MANUAL", "MANUAL",
                "manual-decision", "User decision");
    }

    @Override
    public void finalizeDecision(UUID approvalId, ApprovalDecision decision, String finalStatus,
            String actor, String source, String policy, String rule, String reason) {
        mapper.finalizeDecision(approvalId, preparingStatus(decision, source), finalStatus,
                source, policy, rule, reason);
        mapper.insertAudit(UUID.randomUUID(), approvalId, actor, finalStatus, policy, rule, reason);
    }

    @Override
    public List<ApprovalView> findExpired(int limit) {
        return mapper.findExpired(limit).stream().map(this::toView).toList();
    }

    private String preparingStatus(ApprovalDecision decision) {
        return decision == ApprovalDecision.APPROVED ? "APPROVING" : "DENYING";
    }

    private String preparingStatus(ApprovalDecision decision, String source) {
        if ("AUTO_POLICY".equals(source)) return "AUTO_APPROVING";
        if ("TIMEOUT".equals(source)) return "EXPIRING";
        return preparingStatus(decision);
    }

    private ApprovalView toView(ApprovalRow row) {
        try {
            return new ApprovalView(
                    UUID.fromString(row.getId()),
                    UUID.fromString(row.getTaskId()),
                    UUID.fromString(row.getAttemptId()),
                    row.getRuntimeRunId(),
                    row.getRuntimeApprovalId(), row.getToolName(),
                    objectMapper.readValue(row.getToolInputJson(), TOOL_INPUT_TYPE),
                    row.getRiskLevel(), row.getStatus(), AttemptStatus.valueOf(row.getAttemptStatus()),
                    row.getExpiresAt(), row.getDecidedAt(), row.getCreatedAt(),
                    objectMapper.readValue(row.getApprovalPolicySnapshotJson(), ApprovalPolicySnapshot.class),
                    row.getDecisionSource(), row.getPolicy(), row.getRule(), row.getReason()
            );
        } catch (JsonProcessingException error) {
            throw new IllegalStateException("Stored approval tool input is invalid", error);
        }
    }
}
