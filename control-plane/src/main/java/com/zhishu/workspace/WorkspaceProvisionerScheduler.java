package com.zhishu.workspace;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(
        name = "zhishu.workspace.provisioning.scheduling-enabled",
        havingValue = "true",
        matchIfMissing = true
)
public class WorkspaceProvisionerScheduler {

    private final WorkspaceProvisionerService provisioner;

    public WorkspaceProvisionerScheduler(WorkspaceProvisionerService provisioner) {
        this.provisioner = provisioner;
    }

    @Scheduled(fixedDelayString = "${zhishu.workspace.provisioning.scan-delay:15s}")
    public void reconcile() {
        provisioner.sweep();
    }
}
