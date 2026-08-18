import { createRuntimeRouter } from './runtime.routes.js';
import { runtimeEventReporter } from './runtime-event-reporter.service.js';
import { runtimeService } from './runtime.service.js';

/** Runtime Protocol v1 router consumed by the server composition root. */
export const runtimeRoutes = createRuntimeRouter(runtimeService);

export { createRuntimeService } from './runtime.service.js';
export { runtimeService } from './runtime.service.js';
export { evaluateRuntimeApproval } from './runtime-approval-policy.service.js';

/** Starts durable Runtime event recovery after SQLite initialization. */
export function startRuntimeEventDelivery(): void {
  runtimeEventReporter.start();
}

/** Stops Runtime event delivery during server shutdown without deleting pending records. */
export async function stopRuntimeEventDelivery(): Promise<void> {
  await runtimeEventReporter.stop();
}

/** Returns a secret-free delivery snapshot consumed by the server health endpoint. */
export function getRuntimeEventDeliveryHealth() {
  return runtimeEventReporter.getHealth();
}
