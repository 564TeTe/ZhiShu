import { createTaskCenterGatewayRoutes } from './task-center-gateway.routes.js';

// taskCenterGatewayRoutes: used by the server entrypoint as the authenticated read boundary for the new Task Center.
export const taskCenterGatewayRoutes = createTaskCenterGatewayRoutes();
