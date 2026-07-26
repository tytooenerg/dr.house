import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { requireAuth, requirePlan } from '../auth/middleware.js';
import { getSettings, updateSettings } from '../db/users.js';
import { addApiLog, listApiLogs } from '../db/misc.js';
import { generateApiKey } from '../auth/apiKey.js';
import { createApiKey, getApiKeyUsageThisMonth, listApiKeys, revokeApiKey } from '../db/apiKeys.js';
import { createWebhook, deleteWebhook, getWebhook, listWebhooks } from '../db/webhooks.js';
import { listDeliveriesForWebhook } from '../db/webhookDeliveries.js';
import { fmtRelative } from '../lib/format.js';
import { PLAYGROUND_ENDPOINTS, PLAYGROUND_FIELD_LABELS, WEBHOOK_EVENTS } from '../data/seed.js';
import { asyncHandler } from '../lib/asyncHandler.js';

export const devRouter = Router();
devRouter.use(requireAuth, requirePlan('empresarial'));

function payload(userId: number, settings: ReturnType<typeof getSettings>, playgroundResult: unknown = null, playgroundLoading = false) {
  const ep = PLAYGROUND_ENDPOINTS[settings.playgroundEndpoint];
  return {
    webhookEvents: WEBHOOK_EVENTS,
    apiKeys: listApiKeys(userId)
      .filter((k) => !k.revoked)
      .map((k) => ({
        id: k.id,
        prefix: k.key_prefix,
        label: k.label,
        mode: k.mode,
        scope: k.scope,
        callsThisMonth: getApiKeyUsageThisMonth(k.id),
        createdAt: fmtRelative(k.created_at),
        lastUsed: k.last_used_at ? fmtRelative(k.last_used_at) : 'nunca usada',
      })),
    webhooks: listWebhooks(userId).map((w) => ({ id: w.id, url: w.url, event: w.event, active: !!w.active })),
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

const generateKeySchema = z.object({
  mode: z.enum(['live', 'test']).optional().default('live'),
  scope: z.enum(['read_only', 'read_write']).optional().default('read_write'),
});

devRouter.post('/keys/generate', (req, res) => {
  const parsed = generateKeySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
    return;
  }
  const { mode, scope } = parsed.data;
  const { rawKey, keyHash, keyPrefix } = generateApiKey(mode);
  const label = mode === 'test' ? 'Chave de teste (sandbox)' : 'Chave de produção';
  createApiKey(req.user!.id, keyHash, keyPrefix, label, mode, scope);
  res.json({ rawKey, ...payload(req.user!.id, getSettings(req.user!)) });
});

devRouter.post('/keys/:id/revoke', (req, res) => {
  revokeApiKey(req.user!.id, Number(req.params.id));
  res.json(payload(req.user!.id, getSettings(req.user!)));
});

const webhookSchema = z.object({ url: z.string().trim().url('Informe uma URL válida.'), event: z.enum(WEBHOOK_EVENTS as [string, ...string[]]) });

devRouter.post('/webhooks', (req, res) => {
  const parsed = webhookSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
    return;
  }
  const secret = `whsec_${crypto.randomBytes(16).toString('hex')}`;
  createWebhook(req.user!.id, parsed.data.url, parsed.data.event, secret);
  // The signing secret is only ever shown here, at creation time — same one-time-reveal
  // pattern as the API key — so the partner can configure signature verification on their end.
  res.json({ secret, ...payload(req.user!.id, getSettings(req.user!)) });
});

devRouter.post('/webhooks/:id/delete', (req, res) => {
  deleteWebhook(req.user!.id, Number(req.params.id));
  res.json(payload(req.user!.id, getSettings(req.user!)));
});

devRouter.get('/webhooks/:id/deliveries', (req, res) => {
  const webhookId = Number(req.params.id);
  if (!getWebhook(req.user!.id, webhookId)) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  const deliveries = listDeliveriesForWebhook(req.user!.id, webhookId).map((d) => ({
    id: d.id,
    status: d.status,
    attempt: d.attempt,
    responseStatus: d.response_status,
    error: d.error,
    createdAt: fmtRelative(d.created_at),
    updatedAt: fmtRelative(d.updated_at),
  }));
  res.json({ deliveries });
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
