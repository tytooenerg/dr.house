import { Router } from 'express';
import * as actions from '../store/actions.js';
import { state } from '../store/state.js';
import { ERP_CONNECTORS_META } from '../data/seed.js';

export const erpRouter = Router();

function payload() {
  return {
    connectors: ERP_CONNECTORS_META.map((c) => ({ ...c, connected: (state.erpConnections as any)[c.key] })),
    whitelabelOn: state.erpConnections.whitelabel,
  };
}

erpRouter.get('/', (_req, res) => res.json(payload()));

erpRouter.post('/:key/toggle', (req, res) => {
  actions.toggleErpConnection(req.params.key as any);
  res.json(payload());
});
