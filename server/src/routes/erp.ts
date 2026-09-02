import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { getSettings, updateSettings, getUserById, setWhitelabelPlusEnabled, getUserByWhitelabelDomain, setWhitelabelCustomDomain } from '../db/users.js';
import { ERP_CONNECTORS_META } from '../data/seed.js';
import { testOmieConnection, listarContasReceberOmie, listarContasPagarOmie } from '../lib/erpConnectors/omie.js';
import { testSapConnection, listarContasReceberSap, listarContasPagarSap } from '../lib/erpConnectors/sap.js';
import { testTotvsConnection, listarContasReceberTotvs, listarContasPagarTotvs } from '../lib/erpConnectors/totvs.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { fmtAddOnPrice } from '../lib/addOnBilling.js';
import { upsertErpReceivables } from '../db/erpReceivables.js';
import { upsertErpPayables } from '../db/payables.js';

export const erpRouter = Router();
erpRouter.use(requireAuth);

const REAL_KEYS = new Set(['sap', 'totvs', 'omie']);

function payload(settings: ReturnType<typeof getSettings>, userId: number) {
  const user = getUserById(userId);
  return {
    connectors: ERP_CONNECTORS_META.map((c) => ({
      ...c,
      // All three are real integrations now (lib/erpConnectors/*.ts) — each needs real
      // credentials from the cedente's own ERP tenant, not a bare toggle.
      real: REAL_KEYS.has(c.key),
      connected: (settings.erpConnections as Record<string, boolean>)[c.key],
      btnLabel: (settings.erpConnections as Record<string, boolean>)[c.key] ? 'Conectado ✓' : REAL_KEYS.has(c.key) ? 'Conectar com credenciais reais' : 'Conectar',
      btnBg: (settings.erpConnections as Record<string, boolean>)[c.key] ? '#EAF3EE' : '#1E5EFF',
      btnColor: (settings.erpConnections as Record<string, boolean>)[c.key] ? '#0A5C36' : '#fff',
    })),
    whitelabelOn: settings.erpConnections.whitelabel,
    whitelabelBrand: settings.whitelabelBrand,
    omieConnected: settings.erpConnections.omie,
    sapConnected: settings.erpConnections.sap,
    totvsConnected: settings.erpConnections.totvs,
    autoEmitEnabled: settings.autoEmitEnabled,
    autoEmitMaxValor: settings.autoEmitMaxValor,
    // Auto-emissão only makes sense once at least one real ERP is connected — surfaced so
    // the client can explain why the toggle is disabled otherwise.
    hasErpConnected: settings.erpConnections.omie || settings.erpConnections.sap || settings.erpConnections.totvs,
    // Feature 4 — White-label Plus: a flat monthly recurring add-on (lib/whitelabelBilling.ts)
    // on top of the free branding above, unlocking the extra touchpoints (aceite view
    // brandLabel — lib/aceiteCore.ts). Independent of the plan tier.
    whitelabelPlusEnabled: !!user?.whitelabel_plus_enabled,
    whitelabelPlusPriceFmt: fmtAddOnPrice('whitelabel_plus'),
    // White-label com domínio próprio — a marca aparece na tela de login/shell público de
    // quem visita esse domínio, antes de qualquer autenticação (routes/public.ts GET /brand).
    whitelabelCustomDomain: user?.whitelabel_custom_domain ?? null,
    companyCnpj: settings.companyCnpj,
  };
}

erpRouter.get('/', (req, res) => res.json(payload(getSettings(req.user!), req.user!.id)));

// whitelabel is the only remaining bare toggle here — its real branding form lives at
// POST /whitelabel/brand below; SAP/TOTVS/Omie all go through their own /connect routes.
erpRouter.post('/:key/toggle', (req, res) => {
  const settings = getSettings(req.user!);
  const key = req.params.key as keyof typeof settings.erpConnections;
  if (!(key in settings.erpConnections) || REAL_KEYS.has(key)) {
    res.status(400).json({ error: 'invalid_connector' });
    return;
  }
  const updated = updateSettings(req.user!.id, { erpConnections: { ...settings.erpConnections, [key]: !settings.erpConnections[key] } });
  res.json(payload(updated, req.user!.id));
});

const companyCnpjSchema = z.object({ cnpj: z.string().trim().max(20) });

// Feature "AI CFO — saldo bancário real (Empresarial)" — the one input the cedente has to
// provide by hand for lib/openFinance.ts to look up *their own* company instead of a
// sacado's (every other caller of consultarFluxoDeCaixa passes a sacado's CNPJ during
// risk analysis; this is the first time it's called with the cedente's own).
erpRouter.post('/company-cnpj', (req, res) => {
  const parsed = companyCnpjSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
    return;
  }
  const updated = updateSettings(req.user!.id, { companyCnpj: parsed.data.cnpj });
  res.json(payload(updated, req.user!.id));
});

const omieConnectSchema = z.object({ appKey: z.string().trim().min(1), appSecret: z.string().trim().min(1) });

// Real connection: validates the credentials against Omie's actual API before marking
// the connector as connected — unlike the boolean-only toggle this used to be.
erpRouter.post(
  '/omie/connect',
  asyncHandler(async (req, res) => {
    const parsed = omieConnectSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    const test = await testOmieConnection(parsed.data.appKey, parsed.data.appSecret);
    if (!test.ok) {
      res.status(400).json({ error: 'omie_auth_failed', message: test.error || 'Não foi possível validar as credenciais Omie.' });
      return;
    }
    const settings = getSettings(req.user!);
    const updated = updateSettings(req.user!.id, {
      omieCredentials: { appKey: parsed.data.appKey, appSecret: parsed.data.appSecret },
      erpConnections: { ...settings.erpConnections, omie: true },
    });
    res.json(payload(updated, req.user!.id));
  })
);

erpRouter.post('/omie/disconnect', (req, res) => {
  const settings = getSettings(req.user!);
  const updated = updateSettings(req.user!.id, {
    omieCredentials: null,
    erpConnections: { ...settings.erpConnections, omie: false },
  });
  res.json(payload(updated, req.user!.id));
});

// Real contas-a-receber pull from the cedente's own Omie account — the data Emitir
// Duplicata can prefill from instead of manual entry.
erpRouter.get(
  '/omie/contas-receber',
  asyncHandler(async (req, res) => {
    const settings = getSettings(req.user!);
    if (!settings.omieCredentials) {
      res.status(409).json({ error: 'omie_not_connected' });
      return;
    }
    const result = await listarContasReceberOmie(settings.omieCredentials.appKey, settings.omieCredentials.appSecret);
    if (!result.ok) {
      res.status(502).json({ error: 'omie_fetch_failed', message: result.error });
      return;
    }
    // Snapshot for lib/cashflowForecast.ts (feature "AI CFO enxerga o ERP") — see
    // db/erpReceivables.ts for why this upserts instead of replacing wholesale.
    upsertErpReceivables(
      req.user!.id,
      'omie',
      result.contas.map((c) => ({ externalId: String(c.codigoLancamento), cliente: c.cliente, valor: c.valor, vencimento: c.vencimento }))
    );
    res.json({ contas: result.contas });
  })
);

// Real contas-a-pagar pull (feature "Contas a Pagar via ERP") — mirrors the contas-receber
// route above, but persists straight into the shared `payables` table (db/payables.ts's
// upsertErpPayables) instead of a separate one: same table Contas a Pagar already reads
// from, so a synced conta a pagar shows up there and in the AI CFO projection with no
// separate code path needed.
erpRouter.get(
  '/omie/contas-pagar',
  asyncHandler(async (req, res) => {
    const settings = getSettings(req.user!);
    if (!settings.omieCredentials) {
      res.status(409).json({ error: 'omie_not_connected' });
      return;
    }
    const result = await listarContasPagarOmie(settings.omieCredentials.appKey, settings.omieCredentials.appSecret);
    if (!result.ok) {
      res.status(502).json({ error: 'omie_fetch_failed', message: result.error });
      return;
    }
    upsertErpPayables(
      req.user!.id,
      'omie',
      result.contas.map((c) => ({ externalId: String(c.codigoLancamento), fornecedor: c.fornecedor, numeroDocumento: c.numeroDocumento, valor: c.valor, vencimento: c.vencimento }))
    );
    res.json({ contas: result.contas });
  })
);

const sapConnectSchema = z.object({
  baseUrl: z.string().trim().url(),
  companyDb: z.string().trim().min(1),
  username: z.string().trim().min(1),
  password: z.string().min(1),
});

erpRouter.post(
  '/sap/connect',
  asyncHandler(async (req, res) => {
    const parsed = sapConnectSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    const test = await testSapConnection(parsed.data.baseUrl, parsed.data.companyDb, parsed.data.username, parsed.data.password);
    if (!test.ok) {
      res.status(400).json({ error: 'sap_auth_failed', message: test.error || 'Não foi possível validar as credenciais SAP.' });
      return;
    }
    const settings = getSettings(req.user!);
    const updated = updateSettings(req.user!.id, {
      sapCredentials: parsed.data,
      erpConnections: { ...settings.erpConnections, sap: true },
    });
    res.json(payload(updated, req.user!.id));
  })
);

erpRouter.post('/sap/disconnect', (req, res) => {
  const settings = getSettings(req.user!);
  const updated = updateSettings(req.user!.id, { sapCredentials: null, erpConnections: { ...settings.erpConnections, sap: false } });
  res.json(payload(updated, req.user!.id));
});

erpRouter.get(
  '/sap/contas-receber',
  asyncHandler(async (req, res) => {
    const settings = getSettings(req.user!);
    if (!settings.sapCredentials) {
      res.status(409).json({ error: 'sap_not_connected' });
      return;
    }
    const { baseUrl, companyDb, username, password } = settings.sapCredentials;
    const result = await listarContasReceberSap(baseUrl, companyDb, username, password);
    if (!result.ok) {
      res.status(502).json({ error: 'sap_fetch_failed', message: result.error });
      return;
    }
    upsertErpReceivables(
      req.user!.id,
      'sap',
      result.contas.map((c) => ({ externalId: c.id, cliente: c.cliente, valor: c.valor, vencimento: c.vencimento }))
    );
    res.json({ contas: result.contas });
  })
);

erpRouter.get(
  '/sap/contas-pagar',
  asyncHandler(async (req, res) => {
    const settings = getSettings(req.user!);
    if (!settings.sapCredentials) {
      res.status(409).json({ error: 'sap_not_connected' });
      return;
    }
    const { baseUrl, companyDb, username, password } = settings.sapCredentials;
    const result = await listarContasPagarSap(baseUrl, companyDb, username, password);
    if (!result.ok) {
      res.status(502).json({ error: 'sap_fetch_failed', message: result.error });
      return;
    }
    upsertErpPayables(
      req.user!.id,
      'sap',
      result.contas.map((c) => ({ externalId: c.id, fornecedor: c.fornecedor, numeroDocumento: c.numeroDocumento, valor: c.valor, vencimento: c.vencimento }))
    );
    res.json({ contas: result.contas });
  })
);

const totvsConnectSchema = z.object({
  baseUrl: z.string().trim().url(),
  clientId: z.string().trim().min(1),
  clientSecret: z.string().min(1),
});

erpRouter.post(
  '/totvs/connect',
  asyncHandler(async (req, res) => {
    const parsed = totvsConnectSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    const test = await testTotvsConnection(parsed.data.baseUrl, parsed.data.clientId, parsed.data.clientSecret);
    if (!test.ok) {
      res.status(400).json({ error: 'totvs_auth_failed', message: test.error || 'Não foi possível validar as credenciais TOTVS.' });
      return;
    }
    const settings = getSettings(req.user!);
    const updated = updateSettings(req.user!.id, {
      totvsCredentials: parsed.data,
      erpConnections: { ...settings.erpConnections, totvs: true },
    });
    res.json(payload(updated, req.user!.id));
  })
);

erpRouter.post('/totvs/disconnect', (req, res) => {
  const settings = getSettings(req.user!);
  const updated = updateSettings(req.user!.id, { totvsCredentials: null, erpConnections: { ...settings.erpConnections, totvs: false } });
  res.json(payload(updated, req.user!.id));
});

erpRouter.get(
  '/totvs/contas-receber',
  asyncHandler(async (req, res) => {
    const settings = getSettings(req.user!);
    if (!settings.totvsCredentials) {
      res.status(409).json({ error: 'totvs_not_connected' });
      return;
    }
    const { baseUrl, clientId, clientSecret } = settings.totvsCredentials;
    const result = await listarContasReceberTotvs(baseUrl, clientId, clientSecret);
    if (!result.ok) {
      res.status(502).json({ error: 'totvs_fetch_failed', message: result.error });
      return;
    }
    upsertErpReceivables(
      req.user!.id,
      'totvs',
      result.contas.map((c) => ({ externalId: c.id, cliente: c.cliente, valor: c.valor, vencimento: c.vencimento }))
    );
    res.json({ contas: result.contas });
  })
);

erpRouter.get(
  '/totvs/contas-pagar',
  asyncHandler(async (req, res) => {
    const settings = getSettings(req.user!);
    if (!settings.totvsCredentials) {
      res.status(409).json({ error: 'totvs_not_connected' });
      return;
    }
    const { baseUrl, clientId, clientSecret } = settings.totvsCredentials;
    const result = await listarContasPagarTotvs(baseUrl, clientId, clientSecret);
    if (!result.ok) {
      res.status(502).json({ error: 'totvs_fetch_failed', message: result.error });
      return;
    }
    upsertErpPayables(
      req.user!.id,
      'totvs',
      result.contas.map((c) => ({ externalId: c.id, fornecedor: c.fornecedor, numeroDocumento: c.numeroDocumento, valor: c.valor, vencimento: c.vencimento }))
    );
    res.json({ contas: result.contas });
  })
);

const autoEmitSchema = z.object({ enabled: z.boolean(), maxValor: z.string().trim().min(1).optional() });

// Opt-in — see lib/autoEmitJob.ts. Requires at least one real ERP connected; the cedente
// stays the one who decided to turn this on, and can turn it off at any time.
erpRouter.post(
  '/auto-emit',
  asyncHandler(async (req, res) => {
    const parsed = autoEmitSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    const settings = getSettings(req.user!);
    const hasErp = settings.erpConnections.omie || settings.erpConnections.sap || settings.erpConnections.totvs;
    if (parsed.data.enabled && !hasErp) {
      res.status(409).json({ error: 'no_erp_connected', message: 'Conecte um ERP antes de ativar a emissão automática.' });
      return;
    }
    const updated = updateSettings(req.user!.id, {
      autoEmitEnabled: parsed.data.enabled,
      autoEmitMaxValor: parsed.data.maxValor ?? settings.autoEmitMaxValor,
    });
    res.json(payload(updated, req.user!.id));
  })
);

const whitelabelBrandSchema = z.object({
  nome: z.string().trim().min(1).max(60),
  corPrimaria: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Cor deve estar no formato #RRGGBB.'),
  logoUrl: z.string().trim().url().max(500),
});

// White-label branding — applied to notifications the platform sends to this cedente's
// own sacados/fornecedores (see db/misc.ts addNotification), so the relationship with
// their own supply chain reads as "powered by their brand" instead of raw "Lastro".
// Empresarial-gated at the route level below.
erpRouter.post(
  '/whitelabel/brand',
  asyncHandler(async (req, res) => {
    if (req.user!.plan !== 'empresarial') {
      res.status(402).json({ error: 'plan_required', requiredPlan: 'empresarial', message: 'White-label está disponível a partir do plano Empresarial.' });
      return;
    }
    const parsed = whitelabelBrandSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    const settings = getSettings(req.user!);
    const updated = updateSettings(req.user!.id, {
      whitelabelBrand: parsed.data,
      erpConnections: { ...settings.erpConnections, whitelabel: true },
    });
    res.json(payload(updated, req.user!.id));
  })
);

erpRouter.post('/whitelabel/brand/remove', (req, res) => {
  const settings = getSettings(req.user!);
  const updated = updateSettings(req.user!.id, { whitelabelBrand: null, erpConnections: { ...settings.erpConnections, whitelabel: false } });
  res.json(payload(updated, req.user!.id));
});

const whitelabelDomainSchema = z.object({
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .max(253)
    .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/, 'Informe um domínio ou subdomínio válido, ex. creditos.suaempresa.com.br.'),
});

// White-label com domínio próprio — o passo além da marca cosmética acima (nome/cor numa
// única tela): um domínio real, resolvido em GET /public/brand por req.get('host') a cada
// visita pública, então a marca aparece já na tela de login, antes de qualquer
// autenticação. Requer whitelabelBrand já configurado (nome/cor/logo) — o domínio sozinho
// não tem o que exibir. O apontamento DNS + certificado HTTPS em si é responsabilidade de
// infraestrutura do cliente (ver DEPLOY.md), não algo que esta rota provisiona.
erpRouter.post(
  '/whitelabel/domain',
  asyncHandler(async (req, res) => {
    if (req.user!.plan !== 'empresarial') {
      res.status(402).json({ error: 'plan_required', requiredPlan: 'empresarial', message: 'White-label está disponível a partir do plano Empresarial.' });
      return;
    }
    const settings = getSettings(req.user!);
    if (!settings.whitelabelBrand) {
      res.status(409).json({ error: 'brand_required', message: 'Configure nome, cor e logo em White-label antes de vincular um domínio.' });
      return;
    }
    const parsed = whitelabelDomainSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    const existing = getUserByWhitelabelDomain(parsed.data.domain);
    if (existing && existing.id !== req.user!.id) {
      res.status(409).json({ error: 'domain_taken', message: 'Este domínio já está vinculado a outra conta.' });
      return;
    }
    setWhitelabelCustomDomain(req.user!.id, parsed.data.domain);
    res.json(payload(settings, req.user!.id));
  })
);

erpRouter.post('/whitelabel/domain/remove', (req, res) => {
  setWhitelabelCustomDomain(req.user!.id, null);
  res.json(payload(getSettings(req.user!), req.user!.id));
});

const whitelabelPlusSchema = z.object({ enabled: z.boolean() });

// White-label Plus (feature 4) — a flat monthly recurring add-on (lib/whitelabelBilling.ts)
// unlocking extra branding touchpoints beyond the free WhatsApp-reminder relabeling: the
// sacado's own aceite view now shows the cedente's brand instead of generic "Lastro"
// (lib/aceiteCore.ts). Requires a brand already configured and the Empresarial plan —
// same gate as the free branding above.
erpRouter.post('/whitelabel/plus', (req, res) => {
  if (req.user!.plan !== 'empresarial') {
    res.status(402).json({ error: 'plan_required', requiredPlan: 'empresarial', message: 'White-label Plus está disponível a partir do plano Empresarial.' });
    return;
  }
  const parsed = whitelabelPlusSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
    return;
  }
  const settings = getSettings(req.user!);
  if (parsed.data.enabled && !settings.whitelabelBrand) {
    res.status(409).json({ error: 'brand_required', message: 'Configure sua marca em White-label antes de assinar o White-label Plus.' });
    return;
  }
  setWhitelabelPlusEnabled(req.user!.id, parsed.data.enabled);
  res.json(payload(settings, req.user!.id));
});
