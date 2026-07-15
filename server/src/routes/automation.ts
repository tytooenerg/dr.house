import { Router } from 'express';
import * as actions from '../store/actions.js';
import { state } from '../store/state.js';
import { getSimulatedEstimate } from '../store/computed.js';
import { RATE_CHANNELS } from '../data/seed.js';

export const automationRouter = Router();

function payload() {
  return {
    autoBidEnabled: state.autoBidEnabled,
    autoBidRules: state.autoBidRules,
    diversification: state.diversification,
    sectorDiversification: state.sectorDiversification,
    autoBidActivity: state.autoBidActivity,
  };
}

automationRouter.get('/', (_req, res) => {
  actions.maybeTickAutoBid();
  res.json(payload());
});

automationRouter.post('/toggle', (_req, res) => {
  actions.toggleAutoBid();
  res.json(payload());
});

automationRouter.post('/rule', (req, res) => {
  actions.updateAutoBidRule(req.body.field, req.body.value);
  res.json(payload());
});

automationRouter.post('/diversification', (req, res) => {
  actions.updateDiversification(req.body.cls, Number(req.body.value));
  res.json(payload());
});

automationRouter.post('/sector-diversification', (req, res) => {
  actions.updateSectorDiversification(req.body.cls, Number(req.body.value));
  res.json(payload());
});

export const comparadorRouter = Router();

comparadorRouter.get('/', (_req, res) => {
  res.json({ comparadorInput: state.comparadorInput });
});

comparadorRouter.post('/field', (req, res) => {
  actions.updateComparadorInput(req.body.field, req.body.value);
  res.json({ comparadorInput: state.comparadorInput, estimate: getSimulatedEstimate(), rateChannels: RATE_CHANNELS });
});

comparadorRouter.get('/rates', (_req, res) => {
  res.json({ rateChannels: RATE_CHANNELS, estimate: getSimulatedEstimate() });
});
