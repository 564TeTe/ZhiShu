package com.zhishu.task.persistence;

import java.time.Instant;

final class TaskFollowUpRow {
    private String id;
    private String taskId;
    private String parentAttemptId;
    private String attemptId;
    private String clientRequestId;
    private String actor;
    private String feedback;
    private String requestedAcceptance;
    private String additionalContextJson;
    private int attemptNumber;
    private String attemptStatus;
    private String errorCode;
    private String errorMessage;
    private String acceptanceDecision;
    private String acceptanceReason;
    private Instant acceptanceAt;
    private Instant createdAt;

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getTaskId() { return taskId; }
    public void setTaskId(String taskId) { this.taskId = taskId; }
    public String getParentAttemptId() { return parentAttemptId; }
    public void setParentAttemptId(String parentAttemptId) { this.parentAttemptId = parentAttemptId; }
    public String getAttemptId() { return attemptId; }
    public void setAttemptId(String attemptId) { this.attemptId = attemptId; }
    public String getClientRequestId() { return clientRequestId; }
    public void setClientRequestId(String clientRequestId) { this.clientRequestId = clientRequestId; }
    public String getActor() { return actor; }
    public void setActor(String actor) { this.actor = actor; }
    public String getFeedback() { return feedback; }
    public void setFeedback(String feedback) { this.feedback = feedback; }
    public String getRequestedAcceptance() { return requestedAcceptance; }
    public void setRequestedAcceptance(String requestedAcceptance) { this.requestedAcceptance = requestedAcceptance; }
    public String getAdditionalContextJson() { return additionalContextJson; }
    public void setAdditionalContextJson(String additionalContextJson) { this.additionalContextJson = additionalContextJson; }
    public int getAttemptNumber() { return attemptNumber; }
    public void setAttemptNumber(int attemptNumber) { this.attemptNumber = attemptNumber; }
    public String getAttemptStatus() { return attemptStatus; }
    public void setAttemptStatus(String attemptStatus) { this.attemptStatus = attemptStatus; }
    public String getErrorCode() { return errorCode; }
    public void setErrorCode(String errorCode) { this.errorCode = errorCode; }
    public String getErrorMessage() { return errorMessage; }
    public void setErrorMessage(String errorMessage) { this.errorMessage = errorMessage; }
    public String getAcceptanceDecision() { return acceptanceDecision; }
    public void setAcceptanceDecision(String acceptanceDecision) { this.acceptanceDecision = acceptanceDecision; }
    public String getAcceptanceReason() { return acceptanceReason; }
    public void setAcceptanceReason(String acceptanceReason) { this.acceptanceReason = acceptanceReason; }
    public Instant getAcceptanceAt() { return acceptanceAt; }
    public void setAcceptanceAt(Instant acceptanceAt) { this.acceptanceAt = acceptanceAt; }
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }
}
