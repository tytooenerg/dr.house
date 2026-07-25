import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requirePlan } from '../auth/middleware.js';
import { getSettings, updateSettings } from '../db/users.js';
import { addApiLog, listApiLogs } from '../db/misc.js';
import { fmtRelative } from '../lib/format.js';
import { PLAYGROUND_ENDPOINTS, PLAYGROUND_FIELD_LABELS, WEBHOOK_EVENTS } from '../data/seed.js';
import { asyncHandler } from '../lib/asyncHandler.js';

export const devRouter = Router();
devRouter.use(requireAuth, requirePlan('empresarial'));

function payload(userId: number, settings: ReturnType<typeof getSettings>, playgroundResult: unknown = null, playgroundLoading = false) {
  const ep = PLAYGROUND_ENDPOINTS[settings.playgroundEndpoint];
  return {
    liveKeyRevealed: settings.liveKeyRevealed,
    webhookEnabled: settings.webhookEnabled,
    webhookEvents: WEBHOOK_EVENTS,
    apiLog: listApiLogs(userId).map((r) => ({ status: r.status, method: r.method, path: r.path, time: fmtRelative(r.created_at) })),
    playgroundEndpoint: settings.playgroundEndpoint,
    playgroundEndpoints: Object.entries(PLAYGROUND_ENDPOINTS).map(([key, v]) => ({ key, label: v.label })),
    playgroundMethodPath: `${ep.method} ${ep.path}`,
    playgroundFields: ep.fields.map((f) => ({ key: f, label: PLAYGROUND_FIELD_LABELS[f] || f, value: settings.playgroundParams[f] ?? '' })),
    playgroundLoading,
    playgroundResult,
  };
}

devRouter.get('/', (req, res) => res.json(payload(req.user!.id, getSettings(req.user!))));

devRouter.post('/key/reveal', (req, res) => {
  const settings = getSettings(req.user!);
  const updated = updateSettings(req.user!.id, { liveKeyRevealed: !settings.liveKeyRevealed });
  res.json(payload(req.user!.id, updated));
});

devRouter.post('/webhook/toggle', (req, res) => {
  const settings = getSettings(req.user!);
  const updated = updateSettings(req.user!.id, { webhookEnabled: !settings.webhookEnabled });
  res.json(payload(req.user!.id, updated));
});

const endpointSchema = z.object({ key: z.enum(['emitir', 'consultar', 'lance', 'score', 'webhook']) });

devRouter.post('/playground/endpoint', (req, res) => {
  const parsed = endpointSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
    return;
  }
  const updated = updateSettings(req.user!.id, { playgroundEndpoint: parsed.data.key });
  res.json(payload(req.user!.id, updated));
});

const fieldSchema = z.object({ field: z.string(), value: z.string() });

devRouter.post('/playground/field', (req, res) => {
  const parsed = fieldSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
    return;
  }
  const settings = getSettings(req.user!);
  const updated = updateSettings(req.user!.id, { playgroundParams: { ...settings.playgroundParams, [parsed.data.field]: parsed.data.value } });
  res.json(payload(req.user!.id, updated));
});

devRouter.post(
  '/playground/send',
  asyncHandler(async (req, res) => {
    const settings = getSettings(req.user!);
    const ep = settings.playgroundEndpoint;
    await new Promise((r) => setTimeout(r, 700));
    const p = settings.playgroundParams;
    let body: Record<string, unknown> = {};
    if (ep === 'emitir') {
      body = { id: 'dup_' + Math.random().toString(16).slice(2, 6), status: 'registrada', registro: 'ESC-2026-' + Math.floor(Math.random() * 900000 + 100000), sacado_cnpj: p.sacado_cnpj, valor: parseFloat(p.valor) || 0, vencimento: p.vencimento, seguro: p.seguro === 'true', leilao: 'aberto' };
    } else if (ep === 'consultar') {
      body = { id: p.duplicata_id, status: 'registrada', aceite: 'confirmado', titular_atual: 'Fornecedor Lima Ltda', leilao: 'aberto', lances: 3 };
    } else if (ep === 'lance') {
      const taxaNum = parseFloat(p.taxa) || 0;
      body = { leilao_id: p.leilao_id, lance_id: 'bid_' + Math.random().toString(16).slice(2, 6), taxa: taxaNum, posicao: taxaNum < 2 ? 1 : 2, status: 'ativo' };
    } else if (ep === 'score') {
      body = { cnpj: p.cnpj, score: 812, faixa: 'A', pd_12m: '1.4%', recomendacao: 'aprovar com deságio entre 1,8% e 2,3% a.m.' };
    } else if (ep === 'webhook') {
      body = { id: 'wh_' + Math.random().toString(16).slice(2, 6), url: p.url, evento: p.evento, status: 'ativo' };
    }
    const result = { status: 200, latency: Math.floor(120 + Math.random() * 180), body: JSON.stringify(body, null, 2) };
    addApiLog(req.user!.id, '200', PLAYGROUND_ENDPOINTS[ep].method, PLAYGROUND_ENDPOINTS[ep].path);
    res.json(payload(req.user!.id, settings, result, false));
  })
);
