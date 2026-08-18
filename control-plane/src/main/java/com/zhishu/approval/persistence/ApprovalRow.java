package com.zhishu.approval.persistence;

import java.time.Instant;
final class ApprovalRow {

    private String id;
    private String taskId;
    private String attemptId;
    private String runtimeRunId;
    private String runtimeApprovalId;
    private String toolName;
    private String toolInputJson;
    private String riskLevel;
    private String status;
    private String attemptStatus;
    private Instant expiresAt;
    private Instant decidedAt;
    private Instant createdAt;
    private String approvalPolicySnapshotJson;
    private String decisionSource;
    private String policy;
    private String rule;
    private String reason;

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getTaskId() { return taskId; }
    public void setTaskId(String taskId) { this.taskId = taskId; }
    public String getAttemptId() { return attemptId; }
    public void setAttemptId(String attemptId) { this.attemptId = attemptId; }
    public String getRuntimeRunId() { return runtimeRunId; }
    public void setRuntimeRunId(String runtimeRunId) { this.runtimeRunId = runtimeRunId; }
    public String getRuntimeApprovalId() { return runtimeApprovalId; }
    public void setRuntimeApprovalId(String runtimeApprovalId) { this.runtimeApprovalId = runtimeApprovalId; }
    public String getToolName() { return toolName; }
    public void setToolName(String toolName) { this.toolName = toolName; }
    public String getToolInputJson() { return toolInputJson; }
    public void setToolInputJson(String toolInputJson) { this.toolInputJson = toolInputJson; }
    public String getRiskLevel() { return riskLevel; }
    public void setRiskLevel(String riskLevel) { this.riskLevel = riskLevel; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public String getAttemptStatus() { return attemptStatus; }
    public void setAttemptStatus(String attemptStatus) { this.attemptStatus = attemptStatus; }
    public Instant getExpiresAt() { return expiresAt; }
    public void setExpiresAt(Instant expiresAt) { this.expiresAt = expiresAt; }
    public Instant getDecidedAt() { return decidedAt; }
    public void setDecidedAt(Instant decidedAt) { this.decidedAt = decidedAt; }
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }
    public String getApprovalPolicySnapshotJson() { return approvalPolicySnapshotJson; }
    public void setApprovalPolicySnapshotJson(String value) { this.approvalPolicySnapshotJson = value; }
    public String getDecisionSource() { return decisionSource; }
    public void setDecisionSource(String value) { this.decisionSource = value; }
    public String getPolicy() { return policy; }
    public void setPolicy(String value) { this.policy = value; }
    public String getRule() { return rule; }
    public void setRule(String value) { this.rule = value; }
    public String getReason() { return reason; }
    public void setReason(String value) { this.reason = value; }
}
