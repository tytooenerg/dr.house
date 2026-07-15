import { Router } from 'express';
import * as actions from '../store/actions.js';
import * as computed from '../store/computed.js';
import { state } from '../store/state.js';
import { NOTIFICATIONS } from '../data/seed.js';
import { asyncHandler } from '../lib/asyncHandler.js';

export const dashboardRouter = Router();

dashboardRouter.get('/', (_req, res) => {
  res.json({
    kpis: computed.getKpis(),
    monthlyBars: computed.getMonthlyBars(),
    ratingLegend: computed.getRatingLegend(),
    riskDonutStops: computed.getRiskDonutStops(),
    activeDuplicatas: 342,
  });
});

export const notificationsRouter = Router();
notificationsRouter.get('/', (_req, res) => res.json({ notifications: NOTIFICATIONS, unread: !state.notifRead }));
notificationsRouter.post('/read', (_req, res) => {
  actions.markNotifRead();
  res.json({ ok: true });
});

export const marketRouter = Router();

marketRouter.get('/', (req, res) => {
  if (typeof req.query.q === 'string') actions.setMarketQuery(req.query.q);
  if (typeof req.query.sort === 'string') actions.setMarketSort(req.query.sort);
  res.json({ offers: computed.getFilteredOffers(), query: state.marketQuery, sort: state.marketSort });
});

marketRouter.post('/:id/expand', (req, res) => {
  actions.toggleOfferExpand(Number(req.params.id));
  res.json({ offers: computed.getFilteredOffers() });
});

marketRouter.post('/:id/buy', (req, res) => {
  actions.buyOffer(Number(req.params.id));
  res.json({ offers: computed.getFilteredOffers() });
});

marketRouter.post('/:id/insure', (req, res) => {
  actions.selectInsurer(Number(req.params.id), req.body.key ?? null);
  res.json({ offers: computed.getFilteredOffers() });
});

export const minhasRouter = Router();

minhasRouter.get('/', (_req, res) => res.json({ duplicatas: computed.getMinhasDuplicatas() }));

minhasRouter.post('/:id/leilao', (req, res) => {
  actions.dispararLeilao(req.params.id);
  res.json({ duplicatas: computed.getMinhasDuplicatas() });
});

export const historicoRouter = Router();
historicoRouter.get('/', (_req, res) => res.json({ historico: computed.getHistorico() }));

export const emitirRouter = Router();

function emitPayload() {
  return {
    emitForm: state.emitForm,
    batchRows: state.batchRows,
    nfAnexada: state.nfAnexada,
    emitSubmitted: state.emitSubmitted,
    emitLoading: state.emitLoading,
    emitError: state.emitError,
    lastRegistro: state.lastRegistro,
    lastroChecklist: computed.getLastroChecklist(),
    preApprovedLimit: computed.getPreApprovedLimit(),
    emitSummary: computed.getEmitSummary(),
  };
}

emitirRouter.get('/', (_req, res) => res.json(emitPayload()));

emitirRouter.post('/field', (req, res) => {
  actions.updateEmitForm(req.body.field, req.body.value);
  res.json(emitPayload());
});

emitirRouter.post('/nf', (_req, res) => {
  actions.toggleNfAnexada();
  res.json(emitPayload());
});

emitirRouter.post('/seguro', (_req, res) => {
  actions.toggleEmitSeguro();
  res.json(emitPayload());
});

emitirRouter.post('/batch', (_req, res) => {
  actions.addBatchRow();
  res.json(emitPayload());
});

emitirRouter.post('/batch/:id', (req, res) => {
  actions.updateBatchRow(req.params.id, req.body.valor);
  res.json(emitPayload());
});

emitirRouter.delete('/batch/:id', (req, res) => {
  actions.removeBatchRow(req.params.id);
  res.json(emitPayload());
});

emitirRouter.post(
  '/submit',
  asyncHandler(async (_req, res) => {
    const result = await actions.submitEmit();
    res.json({ ...emitPayload(), result });
  })
);

emitirRouter.post('/reset', (_req, res) => {
  actions.resetEmit();
  res.json(emitPayload());
});

export const aceiteRouter = Router();

aceiteRouter.get('/', (_req, res) => res.json({ aceites: computed.getAceites() }));

aceiteRouter.post(
  '/:id/status',
  asyncHandler(async (req, res) => {
    await actions.setAceiteStatus(Number(req.params.id), req.body.status);
    res.json({ aceites: computed.getAceites() });
  })
);

export const disputaRouter = Router();

disputaRouter.get('/', (_req, res) => res.json({ disputes: computed.getDisputes() }));

disputaRouter.post(
  '/:id/evidence',
  asyncHandler(async (req, res) => {
    await actions.sendDisputeEvidence(Number(req.params.id));
    res.json({ disputes: computed.getDisputes() });
  })
);

disputaRouter.post(
  '/:id/resolve',
  asyncHandler(async (req, res) => {
    await actions.setAceiteStatus(Number(req.params.id), req.body.outcome || 'aceita');
    res.json({ disputes: computed.getDisputes() });
  })
);

export const riscoRouter = Router();

riscoRouter.get('/', (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q : state.riskQuery;
  actions.setRiskQuery(q);
  res.json({ riskQuery: state.riskQuery, suggestions: computed.getRiskSuggestions(q), selected: computed.getSelectedSacado() });
});

riscoRouter.post('/select', (req, res) => {
  actions.selectSacado(req.body.name);
  res.json({ riskQuery: state.riskQuery, suggestions: [], selected: computed.getSelectedSacado() });
});

riscoRouter.post('/clear', (_req, res) => {
  actions.clearSacado();
  res.json({ riskQuery: '', suggestions: [], selected: null });
});
