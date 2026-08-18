package com.zhishu.task.persistence;

import java.util.UUID;

final class ExecutionConfigurationRow {

    private UUID projectId;
    private UUID profileId;
    private String projectRef;
    private String executor;
    private String connectionRef;
    private String modelAlias;
    private String capabilitiesJson;
    private String permissionPolicyJson;
    private int timeoutSeconds;
    private String promptVersion;

    public UUID getProjectId() { return projectId; }
    public void setProjectId(UUID projectId) { this.projectId = projectId; }
    public UUID getProfileId() { return profileId; }
    public void setProfileId(UUID profileId) { this.profileId = profileId; }
    public String getProjectRef() { return projectRef; }
    public void setProjectRef(String projectRef) { this.projectRef = projectRef; }
    public String getExecutor() { return executor; }
    public void setExecutor(String executor) { this.executor = executor; }
    public String getConnectionRef() { return connectionRef; }
    public void setConnectionRef(String connectionRef) { this.connectionRef = connectionRef; }
    public String getModelAlias() { return modelAlias; }
    public void setModelAlias(String modelAlias) { this.modelAlias = modelAlias; }
    public String getCapabilitiesJson() { return capabilitiesJson; }
    public void setCapabilitiesJson(String capabilitiesJson) { this.capabilitiesJson = capabilitiesJson; }
    public String getPermissionPolicyJson() { return permissionPolicyJson; }
    public void setPermissionPolicyJson(String permissionPolicyJson) { this.permissionPolicyJson = permissionPolicyJson; }
    public int getTimeoutSeconds() { return timeoutSeconds; }
    public void setTimeoutSeconds(int timeoutSeconds) { this.timeoutSeconds = timeoutSeconds; }
    public String getPromptVersion() { return promptVersion; }
    public void setPromptVersion(String promptVersion) { this.promptVersion = promptVersion; }
}
