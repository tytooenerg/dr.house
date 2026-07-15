import { Router } from 'express';
import * as actions from '../store/actions.js';
import { state } from '../store/state.js';
import { PLAYGROUND_ENDPOINTS, PLAYGROUND_FIELD_LABELS, WEBHOOK_EVENTS } from '../data/seed.js';
import { asyncHandler } from '../lib/asyncHandler.js';

export const devRouter = Router();

function payload() {
  const ep = PLAYGROUND_ENDPOINTS[state.playgroundEndpoint];
  return {
    liveKeyRevealed: state.liveKeyRevealed,
    webhookEnabled: state.webhookEnabled,
    webhookEvents: WEBHOOK_EVENTS,
    apiLog: state.apiLog,
    playgroundEndpoint: state.playgroundEndpoint,
    playgroundEndpoints: Object.entries(PLAYGROUND_ENDPOINTS).map(([key, v]) => ({ key, label: v.label })),
    playgroundMethodPath: `${ep.method} ${ep.path}`,
    playgroundFields: ep.fields.map((f) => ({ key: f, label: PLAYGROUND_FIELD_LABELS[f] || f, value: state.playgroundParams[f] })),
    playgroundLoading: state.playgroundLoading,
    playgroundResult: state.playgroundResult,
  };
}

devRouter.get('/', (_req, res) => res.json(payload()));

devRouter.post('/key/reveal', (_req, res) => {
  actions.toggleKeyReveal();
  res.json(payload());
});

devRouter.post('/webhook/toggle', (_req, res) => {
  actions.toggleWebhook();
  res.json(payload());
});

devRouter.post('/playground/endpoint', (req, res) => {
  actions.setPlaygroundEndpoint(req.body.key);
  res.json(payload());
});

devRouter.post('/playground/field', (req, res) => {
  actions.updatePlaygroundParam(req.body.field, req.body.value);
  res.json(payload());
});

devRouter.post(
  '/playground/send',
  asyncHandler(async (_req, res) => {
    await actions.sendPlaygroundRequest();
    res.json(payload());
  })
);
