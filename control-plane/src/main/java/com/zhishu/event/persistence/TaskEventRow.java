package com.zhishu.event.persistence;

import java.time.Instant;
final class TaskEventRow {

    private long id;
    private String eventId;
    private String taskId;
    private String attemptId;
    private String runtimeRunId;
    private long sequenceNo;
    private String eventType;
    private String payloadJson;
    private Instant occurredAt;
    private Instant receivedAt;

    public long getId() { return id; }
    public void setId(long id) { this.id = id; }
    public String getEventId() { return eventId; }
    public void setEventId(String eventId) { this.eventId = eventId; }
    public String getTaskId() { return taskId; }
    public void setTaskId(String taskId) { this.taskId = taskId; }
    public String getAttemptId() { return attemptId; }
    public void setAttemptId(String attemptId) { this.attemptId = attemptId; }
    public String getRuntimeRunId() { return runtimeRunId; }
    public void setRuntimeRunId(String runtimeRunId) { this.runtimeRunId = runtimeRunId; }
    public long getSequenceNo() { return sequenceNo; }
    public void setSequenceNo(long sequenceNo) { this.sequenceNo = sequenceNo; }
    public String getEventType() { return eventType; }
    public void setEventType(String eventType) { this.eventType = eventType; }
    public String getPayloadJson() { return payloadJson; }
    public void setPayloadJson(String payloadJson) { this.payloadJson = payloadJson; }
    public Instant getOccurredAt() { return occurredAt; }
    public void setOccurredAt(Instant occurredAt) { this.occurredAt = occurredAt; }
    public Instant getReceivedAt() { return receivedAt; }
    public void setReceivedAt(Instant receivedAt) { this.receivedAt = receivedAt; }
}
