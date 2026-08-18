import express from 'express';

import type { createRuntimeConnectionsService } from './runtime-connections.service.js';

export function createRuntimeConnectionsRouter(service: ReturnType<typeof createRuntimeConnectionsService>): express.Router {
  const router = express.Router();
  const id = (req: express.Request): string => Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const respond = (operation: (req: express.Request) => unknown | Promise<unknown>) => async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    try { res.json(await operation(req)); } catch (error) { next(error); }
  };
  router.get('/', respond(() => service.list()));
  router.post('/', respond((req) => service.create(req.body ?? {})));
  router.patch('/:id', respond((req) => service.update(id(req), req.body ?? {})));
  router.post('/:id/test', respond((req) => service.test(id(req))));
  router.delete('/:id', respond((req) => service.remove(id(req))));
  return router;
}
