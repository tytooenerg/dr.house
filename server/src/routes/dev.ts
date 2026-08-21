import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { planAtLeast } from '../lib/billing.js';
import { getSettings, updateSettings } from '../db/users.js';
import { addApiLog, listApiLogs } from '../db/misc.js';
import { generateApiKey } from '../auth/apiKey.js';
import { createApiKey, getApiKeyUsageThisMonth, listApiKeys, revokeApiKey } from '../db/apiKeys.js';
import { ensureSandboxDataset } from '../lib/sandboxData.js';
import { createWebhook, deleteWebhook, getWebhook, listWebhooks, rotateWebhookSecret } from '../db/webhooks.js';
import { listDeliveriesForWebhook } from '../db/webhookDeliveries.js';
import { fmtRelative, fmtBRL } from '../lib/format.js';
import { PLAYGROUND_ENDPOINTS, PLAYGROUND_FIELD_LABELS, WEBHOOK_EVENTS } from '../data/seed.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { checkUrlIsPublic } from '../lib/ssrfGuard.js';
import { getIncludedCallsPerMonth } from '../lib/apiOverageBilling.js';
import { fmtAddOnPrice, getAddOnPrice } from '../lib/addOnBilling.js';
import { listAddOnChargesByUser } from '../db/addOnCharges.js';
import type { ApiKeyProduct } from '../db/types.js';

export const devRouter = Router();
// Any authenticated account can reach Desenvolvedores and generate a free sandbox
// (test-mode) key to explore the API — only *live* keys and webhooks are gated behind
// Empresarial, since those touch real production data/side effects.
devRouter.use(requireAuth);

function payload(userId: number, settings: ReturnType<typeof getSettings>, playgroundResult: unknown = null, playgroundLoading = false) {
  const ep = PLAYGROUND_ENDPOINTS[settings.playgroundEndpoint];
  const keys = listApiKeys(userId).filter((k) => !k.revoked);
  const platformCallsThisMonth = keys
    .filter((k) => k.mode === 'live' && k.product === 'platform')
    .reduce((sum, k) => sum + getApiKeyUsageThisMonth(k.id), 0);
  const included = getIncludedCallsPerMonth();
  return {
    webhookEvents: WEBHOOK_EVENTS,
    apiKeys: keys.map((k) => ({
      id: k.id,
      prefix: k.key_prefix,
      label: k.label,
      mode: k.mode,
      scope: k.scope,
      product: k.product,
      callsThisMonth: getApiKeyUsageThisMonth(k.id),
      createdAt: fmtRelative(k.created_at),
      lastUsed: k.last_used_at ? fmtRelative(k.last_used_at) : 'nunca usada',
    })),
    // Feature 1 — API usage overage: what an Empresarial account with live platform keys
    // would owe (or already owes) beyond the monthly included quota. Estimated live from
    // this month's still-accumulating usage; the real charge only posts once the billing
    // job runs for the completed month (lib/apiOverageBilling.ts).
    apiOverage: {
      includedCallsPerMonth: included,
      callsThisMonth: platformCallsThisMonth,
      overageThisMonth: Math.max(0, platformCallsThisMonth - included),
      pricePerCallFmt: fmtAddOnPrice('api_overage'),
      estimatedChargeFmt: fmtBRL(Math.max(0, platformCallsThisMonth - included) * getAddOnPrice('api_overage')),
    },
    // Features 2/3/4 — standalone data-product keys and what they've cost so far.
    scoreApiPriceFmt: fmtAddOnPrice('score_api'),
    pldScreeningApiPriceFmt: fmtAddOnPrice('pld_screening_api'),
    registroApiPriceFmt: fmtAddOnPrice('registro_api'),
    addonCharges: listAddOnChargesByUser(userId, 20).map((c) => ({
      id: c.id,
      kind: c.kind,
      quantidade: c.quantity,
      valorFmt: fmtBRL(c.amount),
      descricao: c.description,
      quando: fmtRelative(c.created_at),
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
  // 'score_api'/'pld_screening_api' are standalone, pay-per-call data products (features
  // 2/3) — deliberately NOT gated behind Empresarial the way the full 'platform' product
  // is, since they're sold on their own, billed per call, not part of the subscription.
  product: z.enum(['platform', 'score_api', 'pld_screening_api', 'registro_api']).optional().default('platform'),
});

devRouter.post('/keys/generate', (req, res) => {
  const parsed = generateKeySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
    return;
  }
  const { mode, scope, product } = parsed.data;
  // A conta "só-API" (api_partner) nunca é dona de duplicatas/leilões — o produto
  // 'platform' pressupõe um participante do marketplace agindo em nome próprio, o que
  // uma conta só-API nunca é. Bloqueado aqui, não só escondido no client, porque é uma
  // garantia real do produto ("só a API, nunca o marketplace"), não só UX.
  if (product === 'platform' && req.user!.role === 'api_partner') {
    res.status(403).json({ error: 'role_not_allowed', message: 'Contas só-API têm acesso apenas ao Score API e ao PLD Screening API.' });
    return;
  }
  if (mode === 'live' && product === 'platform' && !planAtLeast(req.user!.plan, 'empresarial')) {
    res.status(402).json({
      error: 'plan_required',
      requiredPlan: 'empresarial',
      message: 'Chaves de produção requerem o plano Empresarial. Gere uma chave sandbox para explorar a API sem custo, ou faça upgrade para ir ao ar.',
    });
    return;
  }
  const { rawKey, keyHash, keyPrefix } = generateApiKey(mode);
  const productLabel: Record<ApiKeyProduct, string> = { platform: '', score_api: 'Score API', pld_screening_api: 'PLD Screening API', registro_api: 'Registro API' };
  const label = product === 'platform' ? (mode === 'test' ? 'Chave de teste (sandbox)' : 'Chave de produção') : `${productLabel[product]} (${mode === 'test' ? 'teste' : 'produção'})`;
  createApiKey(req.user!.id, keyHash, keyPrefix, label, mode, scope, product);
  if (mode === 'test' && product === 'platform') ensureSandboxDataset(req.user!);
  res.json({ rawKey, ...payload(req.user!.id, getSettings(req.user!)) });
});

devRouter.post('/keys/:id/revoke', (req, res) => {
  revokeApiKey(req.user!.id, Number(req.params.id));
  res.json(payload(req.user!.id, getSettings(req.user!)));
});

const webhookSchema = z.object({ url: z.string().trim().url('Informe uma URL válida.'), event: z.enum(WEBHOOK_EVENTS as [string, ...string[]]) });

devRouter.post(
  '/webhooks',
  asyncHandler(async (req, res) => {
    if (!planAtLeast(req.user!.plan, 'empresarial')) {
      res.status(402).json({ error: 'plan_required', requiredPlan: 'empresarial', message: 'Webhooks requerem o plano Empresarial.' });
      return;
    }
    const parsed = webhookSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    // SSRF guard (lib/ssrfGuard.ts, security-review finding SR-1) — a webhook URL is
    // requested by the same account that receives the delivery attempts/errors, so
    // rejecting a private/internal address here is a real check, not just UX politeness.
    const check = await checkUrlIsPublic(parsed.data.url);
    if (!check.safe) {
      res.status(400).json({ error: 'validation_error', message: check.reason || 'URL de webhook não permitida.' });
      return;
    }
    const secret = `whsec_${crypto.randomBytes(16).toString('hex')}`;
    createWebhook(req.user!.id, parsed.data.url, parsed.data.event, secret);
    // The signing secret is only ever shown here, at creation time — same one-time-reveal
    // pattern as the API key — so the partner can configure signature verification on their end.
    res.json({ secret, ...payload(req.user!.id, getSettings(req.user!)) });
  })
);

devRouter.post('/webhooks/:id/delete', (req, res) => {
  deleteWebhook(req.user!.id, Number(req.params.id));
  res.json(payload(req.user!.id, getSettings(req.user!)));
});

// Real secret rotation (see db/webhooks.ts rotateWebhookSecret) — invalidates the old
// signing secret immediately, without losing the webhook's registration or delivery
// history, the same one-time-reveal shape as creation: the new value is only ever
// returned in this response, never shown again after.
devRouter.post('/webhooks/:id/rotate-secret', (req, res) => {
  const webhookId = Number(req.params.id);
  if (!getWebhook(req.user!.id, webhookId)) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  const secret = `whsec_${crypto.randomBytes(16).toString('hex')}`;
  rotateWebhookSecret(req.user!.id, webhookId, secret);
  res.json({ secret, ...payload(req.user!.id, getSettings(req.user!)) });
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
