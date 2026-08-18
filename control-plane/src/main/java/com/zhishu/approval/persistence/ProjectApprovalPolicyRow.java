package com.zhishu.approval.persistence;

import java.time.Instant;

final class ProjectApprovalPolicyRow {
    private String projectId;
    private String projectRoot;
    private String mode;
    private String allowedDirectoriesJson;
    private String trustedCommandsJson;
    private int approvalTimeoutSeconds;
    private Instant updatedAt;

    public String getProjectId() { return projectId; }
    public void setProjectId(String projectId) { this.projectId = projectId; }
    public String getProjectRoot() { return projectRoot; }
    public void setProjectRoot(String projectRoot) { this.projectRoot = projectRoot; }
    public String getMode() { return mode; }
    public void setMode(String mode) { this.mode = mode; }
    public String getAllowedDirectoriesJson() { return allowedDirectoriesJson; }
    public void setAllowedDirectoriesJson(String value) { this.allowedDirectoriesJson = value; }
    public String getTrustedCommandsJson() { return trustedCommandsJson; }
    public void setTrustedCommandsJson(String value) { this.trustedCommandsJson = value; }
    public int getApprovalTimeoutSeconds() { return approvalTimeoutSeconds; }
    public void setApprovalTimeoutSeconds(int value) { this.approvalTimeoutSeconds = value; }
    public Instant getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(Instant updatedAt) { this.updatedAt = updatedAt; }
}
