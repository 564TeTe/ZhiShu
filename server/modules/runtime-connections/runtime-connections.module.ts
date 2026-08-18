import { runtimeService } from '@/modules/runtime/index.js';

import { createRuntimeConnectionsRouter } from './runtime-connections.routes.js';
import { createRuntimeConnectionsService } from './runtime-connections.service.js';

export const runtimeConnectionRoutes = createRuntimeConnectionsRouter(createRuntimeConnectionsService({
  isConnectionInUse: runtimeService.isConnectionInUse,
}));
