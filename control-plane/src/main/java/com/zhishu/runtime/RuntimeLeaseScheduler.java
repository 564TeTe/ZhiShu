package com.zhishu.runtime;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(name = "zhishu.runtime.lease.scheduling-enabled", havingValue = "true", matchIfMissing = true)
public class RuntimeLeaseScheduler {

    private final RuntimeLeaseService leases;

    public RuntimeLeaseScheduler(RuntimeLeaseService leases) {
        this.leases = leases;
    }

    @Scheduled(fixedDelayString = "${zhishu.runtime.lease.scan-delay:5s}")
    public void sweepExpiredLeases() {
        leases.sweep();
    }
}
