import { Router } from 'express';
import * as actions from '../store/actions.js';
import { state } from '../store/state.js';
import {
  AUDIT_LOG, CRONOGRAMA, CONTRACT_FLAGS, FINANCIADOR_REQS, FRAUD_FLAGS, TRUST_BRIDGE,
} from '../data/seed.js';
import { fmtBRL, parseBRLNumber } from '../lib/format.js';

export const complianceRouter = Router();

function fidcPayload() {
  const pl = parseBRLNumber(state.fidcPL);
  return { fidcPL: state.fidcPL, fidcOriginacaoFmt: fmtBRL(pl * 2.2), fidcSpreadLabel: '1,8% a.m.' };
}

complianceRouter.get('/', (_req, res) => {
  res.json({
    trustBridge: TRUST_BRIDGE,
    financiadorReqs: FINANCIADOR_REQS,
    cronograma: CRONOGRAMA,
    auditLog: AUDIT_LOG,
    fraudFlags: FRAUD_FLAGS,
    contractFlags: CONTRACT_FLAGS,
    dupQuery: state.dupQuery,
    dupChecked: state.dupChecked,
    interop: [
      { name: 'CERC', lastCheck: 40 },
      { name: 'B3', lastCheck: 12 },
      { name: 'Núclea', lastCheck: 3 },
    ],
    ...fidcPayload(),
  });
});

complianceRouter.post('/fidc', (req, res) => {
  actions.updateFidcPL(req.body.value);
  res.json(fidcPayload());
});

complianceRouter.post('/dup-check', (req, res) => {
  state.dupQuery = req.body.query ?? state.dupQuery;
  actions.runDupCheck();
  res.json({ dupQuery: state.dupQuery, dupChecked: state.dupChecked });
});
