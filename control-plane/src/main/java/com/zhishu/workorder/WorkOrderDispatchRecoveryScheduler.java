package com.zhishu.workorder;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(
        name = "zhishu.work-order.dispatch.scheduling-enabled",
        havingValue = "true",
        matchIfMissing = true
)
public class WorkOrderDispatchRecoveryScheduler {

    private final WorkOrderService workOrders;

    public WorkOrderDispatchRecoveryScheduler(WorkOrderService workOrders) {
        this.workOrders = workOrders;
    }

    @Scheduled(fixedDelayString = "${zhishu.work-order.dispatch.scan-delay:5s}")
    public void recoverExpiredDispatches() {
        workOrders.recoverDispatches(25);
    }
}
