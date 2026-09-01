import { Router } from 'express';
import { z } from 'zod';
import { apiKeyAbuseBackstop, apiKeyRateLimiter, requireApiKey, requireWriteScope } from '../auth/apiKey.js';
import { emitirFormSchema, submitEmitir } from '../lib/emitirCore.js';
import { aceiteStatusSchema, decideAceite, listAceitesForUser } from '../lib/aceiteCore.js';
import { buildSeguradoraPayload, decideSinistro, sinistroDecisionSchema } from '../lib/seguradoraCore.js';
import { buildBlendedRiscoView } from '../lib/riscoCore.js';
import { addSignal } from '../db/networkSignals.js';
import { getRegistradora, chooseRegistradora, registrarNaRegistradora, checkDuplicidadeNaRegistradora, RegistroIndisponivelError } from '../lib/registradoras.js';
import { withIdempotency } from '../lib/idempotency.js';
import { getDuplicata, listMarketplace, listBySacadoNome } from '../db/duplicatas.js';
import { buildOfferView } from '../lib/marketCompute.js';
import { fmtBRL } from '../lib/format.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { chargePerCall } from '../lib/addOnBilling.js';
import { screenEntity } from '../db/sanctions.js';
import { deliverWebhookEvent } from '../lib/webhookDelivery.js';
import { apiVersioningHeaders } from '../lib/apiVersioning.js';
import { screenJudicialRecords, judicialRecordsEnabled } from '../lib/judicialRecords.js';
import { screenFraudSignals } from '../lib/fraudScreeningApi.js';
import { analyzeContract } from '../lib/contractAnalysis.js';
import { extractNfeFields } from '../lib/nfeExtraction.js';
import { claudeEnabled } from '../lib/claude.js';
import { reconcileAgainstExpected } from '../lib/reconciliationApi.js';
import { OfxParseError } from '../lib/ofxParser.js';
import { scoreAnswers, PROFILE_LABEL, MAX_SCORE } from '../lib/suitability.js';
import { buildMarketIndex } from '../lib/marketIndex.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

// Public, versioned, API-key-authenticated endpoints for external partners (ERPs, FIDCs,
// securitizadoras, sacados, seguradoras…) to integrate with directly — distinct from the
// internal /api/* used by the SPA, which is cookie/JWT-authenticated and not meant for
// third parties. See GET /api/v1/openapi.json for the full machine-readable reference, and
// docs/api-versioning-policy.md for how this version is maintained/deprecated over time.
export const v1Router = Router();
// Real Deprecation/Sunset headers (lib/apiVersioning.ts) on every response, before auth
// even resolves — a no-op today (v1 isn't deprecated), becomes real the moment an admin
// sets a sunset date. Then the coarse IP backstop (no identity resolved yet), then
// requireApiKey resolves req.apiKey/req.apiUser, then the real plan-aware limiter (which
// reads them) runs last — see auth/apiKey.ts for why each exists.
v1Router.use(apiVersioningHeaders);
v1Router.use(apiKeyAbuseBackstop, requireApiKey, apiKeyRateLimiter);

// A narrow-product key (Score API / PLD screening API — features 2/3, sold standalone to
// companies that aren't full Lastro partners) can only ever reach the one endpoint it was
// sold for. 'platform' keys (every key issued before this feature, and every normal
// partner key today) are unaffected — this only restricts the two new product types.
v1Router.use((req, res, next) => {
  const product = req.apiKey!.product;
  if (product === 'platform') {
    next();
    return;
  }
  const isScoreRoute = product === 'score_api' && req.method === 'GET' && /^\/sacados\/[^/]+\/score$/.test(req.path);
  const isPldRoute = product === 'pld_screening_api' && req.method === 'POST' && req.path === '/pld/triagem';
  const isRegistroRoute = product === 'registro_api' && req.method === 'POST' && req.path === '/registro';
  const isJudicialRoute = product === 'judicial_records_api' && req.method === 'POST' && req.path === '/judicial/consulta';
  const isFraudRoute = product === 'fraud_screening_api' && req.method === 'POST' && req.path === '/fraude/avaliar';
  const isDocRoute = product === 'document_intelligence_api' && req.method === 'POST' && req.path === '/documentos/analisar';
  const isReconciliationRoute = product === 'reconciliation_api' && req.method === 'POST' && req.path === '/conciliacao';
  const isSuitabilityRoute = product === 'suitability_api' && req.method === 'POST' && req.path === '/suitability/avaliar';
  const isIndexRoute = product === 'market_index_api' && req.method === 'GET' && req.path === '/index';
  if (isScoreRoute || isPldRoute || isRegistroRoute || isJudicialRoute || isFraudRoute || isDocRoute || isReconciliationRoute || isSuitabilityRoute || isIndexRoute) {
    next();
    return;
  }
  res.status(403).json({
    error: 'forbidden',
    message: 'Esta chave é válida apenas para o produto contratado (Score API, PLD Screening API, Registro API, Judicial Records API, Fraud Screening API, Document Intelligence API, Reconciliation API, Suitability API ou Lastro Index).',
  });
});

function idempotencyHeader(req: import('express').Request): string | undefined {
  const raw = req.header('Idempotency-Key');
  return raw && raw.trim() ? raw.trim() : undefined;
}

v1Router.post(
  '/duplicatas',
  requireWriteScope,
  asyncHandler(async (req, res) => {
    if (req.apiUser!.role !== 'cedente') {
      res.status(403).json({ error: 'forbidden', message: 'Apenas chaves de contas cedente podem emitir duplicatas.' });
      return;
    }
    const parsed = emitirFormSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    const sandbox = req.apiKey!.mode === 'test';
    const outcome = await withIdempotency(req.apiUser!.id, 'POST /v1/duplicatas', idempotencyHeader(req), req.body, () =>
      submitEmitir(req.apiUser!, parsed.data, { sandbox })
    );
    res.status(outcome.status).json({ ...outcome.body, mode: req.apiKey!.mode });
  })
);

// A test-mode key can only ever see sandbox=1 rows, and a live key only sandbox=0 —
// enforced here (not just at listing time) so a partner can't probe for a real
// duplicata's ID via a test key, or vice versa. See db/duplicatas.ts / lib/sandboxData.ts.
v1Router.get('/duplicatas/:id', (req, res) => {
  const d = getDuplicata(req.params.id);
  if (!d || !!d.sandbox !== (req.apiKey!.mode === 'test')) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  res.json({
    id: d.id,
    status: d.status,
    sacado: d.sacado_nome,
    cedente: d.cedente_nome,
    valorFmt: fmtBRL(d.valor),
    vencimento: d.vencimento,
    registro: d.registro,
    registradora: getRegistradora(d.registradora)?.name ?? null,
    lastroPct: d.lastro_pct,
    seguro: !!d.seguro,
  });
});

// A test-mode key sees only the seeded sandbox marketplace (lib/sandboxData.ts) — never
// the real, live offers other partners' live keys operate on.
v1Router.get('/marketplace', (req, res) => {
  res.json({ offers: listMarketplace(req.apiKey!.mode === 'test').map(buildOfferView) });
});

// Sacado-facing aceite endpoints — a sacado's ERP can list pending aceites and
// confirm/contest them programmatically, mirroring /api/aceites for the SPA. A
// test-mode key only ever sees/acts on its own seeded sandbox aceites (lib/sandboxData.ts).
v1Router.get('/aceites', (req, res) => {
  res.json({ aceites: listAceitesForUser(req.apiUser!, req.apiKey!.mode === 'test') });
});

v1Router.post(
  '/aceites/:id/status',
  requireWriteScope,
  asyncHandler(async (req, res) => {
    const parsed = aceiteStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    const sandbox = req.apiKey!.mode === 'test';
    const outcome = await withIdempotency(req.apiUser!.id, 'POST /v1/aceites/:id/status', idempotencyHeader(req), req.body, () =>
      decideAceite(req.apiUser!, Number(req.params.id), parsed.data.status, sandbox)
    );
    res.status(outcome.status).json(outcome.body);
  })
);

// Seguradora-facing endpoints — a partner insurer's own systems can pull apólices/sinistros
// and decide claims programmatically, mirroring /api/seguradora for the SPA. A test-mode
// key only ever sees/decides its own sandbox sinistros (lib/sandboxData.ts's data plane),
// never a real one — same isolation /v1/aceites and /v1/duplicatas/:id already enforce.
v1Router.get('/seguradora', (req, res) => {
  if (req.apiUser!.role !== 'seguradora') {
    res.status(403).json({ error: 'forbidden', message: 'Apenas chaves de contas seguradora podem acessar este recurso.' });
    return;
  }
  res.json(buildSeguradoraPayload(req.apiUser!, req.apiKey!.mode === 'test'));
});

v1Router.post(
  '/seguradora/sinistro/:duplicataId/decidir',
  requireWriteScope,
  asyncHandler(async (req, res) => {
    if (req.apiUser!.role !== 'seguradora') {
      res.status(403).json({ error: 'forbidden', message: 'Apenas chaves de contas seguradora podem acessar este recurso.' });
      return;
    }
    const parsed = sinistroDecisionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    const sandbox = req.apiKey!.mode === 'test';
    const outcome = await withIdempotency(
      req.apiUser!.id,
      'POST /v1/seguradora/sinistro/:duplicataId/decidir',
      idempotencyHeader(req),
      req.body,
      () => decideSinistro(req.apiUser!, req.params.duplicataId, parsed.data, sandbox)
    );
    res.status(outcome.status).json(outcome.body);
  })
);

// Real-time credit score lookup by CNPJ — blends Lastro's own transaction history (if
// any) with signals reported by partners (see POST below), so even a CNPJ that never
// transacted directly on Lastro can get a real score from cross-platform reputation.
v1Router.get(
  '/sacados/:cnpj/score',
  asyncHandler(async (req, res) => {
    const view = await buildBlendedRiscoView(req.params.cnpj, req.apiUser!.id);
    if (!view) {
      res.status(404).json({ error: 'not_found', message: 'Nenhum histórico de score encontrado para este CNPJ.' });
      return;
    }
    // Only a standalone Score API key (feature 2) gets charged per call — a full
    // 'platform' key's score access is already covered by its subscription/overage
    // billing (lib/apiOverageBilling.ts), never double-billed.
    if (req.apiKey!.product === 'score_api') {
      await chargePerCall(req.apiUser!.id, 'score_api', `Consulta de score via Score API — CNPJ ${req.params.cnpj}`);
    }
    res.json(view);
  })
);

const sinalSchema = z.object({
  tipo: z.enum(['pagamento_pontual', 'atraso', 'protesto', 'contestacao']),
  nota: z.string().trim().max(500).optional(),
});

// Any partner integrating with the API can report a payment-behavior observation about
// a CNPJ — this is the shared risk-data network: a bank, FIDC or ERP that saw a sacado
// pay late (or on time) contributes that signal back into everyone's score, instead of
// each platform's risk data staying siloed. Read-only keys can't contribute (write scope).
v1Router.post(
  '/sacados/:cnpj/sinais',
  requireWriteScope,
  asyncHandler(async (req, res) => {
    const parsed = sinalSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    // Fire rating.alterado to every cedente with a real (non-sandbox) relationship to this
    // sacado only when the reported signal actually moved the rating band (AA/A/B/C), not
    // on every signal — a cedente cares "did my counterparty's risk profile change",
    // not "did someone report anything at all".
    const before = await buildBlendedRiscoView(req.params.cnpj);
    addSignal(req.params.cnpj, req.apiUser!.id, parsed.data.tipo, parsed.data.nota);
    const view = await buildBlendedRiscoView(req.params.cnpj, req.apiUser!.id);
    if (view && before && view.rating !== before.rating) {
      const cedenteIds = new Set(listBySacadoNome(view.name).map((d) => d.cedente_id).filter((id): id is number => id !== null));
      for (const cedenteId of cedenteIds) {
        void deliverWebhookEvent(cedenteId, 'rating.alterado', {
          sacado: view.name,
          cnpj: req.params.cnpj,
          ratingAnterior: before.rating,
          ratingAtual: view.rating,
          score: view.score,
        });
      }
    }
    res.json(view);
  })
);

const pldTriagemSchema = z.object({
  nome: z.string().trim().min(2, 'Informe o nome a ser triado.'),
  documento: z.string().trim().max(40).optional().default(''),
});

// Feature 3 — PLD/KYC screening as a standalone product: wraps the exact same real
// OFAC + UN Security Council Consolidated List + demo-watchlist screening every KYB
// submission already goes through (db/sanctions.ts), sold on its own to a company that
// wants compliance screening without building it — the same reuse-what's-already-real
// pattern as the Score API. A 'platform' key can call this too, bundled at no extra
// charge; only a dedicated pld_screening_api key gets billed per call.
v1Router.post(
  '/pld/triagem',
  asyncHandler(async (req, res) => {
    const parsed = pldTriagemSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    const match = await screenEntity(parsed.data.nome, parsed.data.documento, req.apiUser!.id);
    if (req.apiKey!.product === 'pld_screening_api') {
      await chargePerCall(req.apiUser!.id, 'pld_screening_api', `Triagem PLD via API — ${parsed.data.nome}`);
    }
    res.json({
      nome: parsed.data.nome,
      flagged: !!match,
      match: match ? { nome: match.nome, tipo: match.tipo, fonte: match.fonte } : null,
    });
  })
);

const registroSchema = z.object({
  referenciaExterna: z.string().trim().min(1).max(80),
  sacadoCnpj: z.string().trim().min(11).max(20),
  valor: z.number().positive().max(50_000_000),
  vencimento: z.string().trim().min(8).max(10),
});

// Feature "compliance-as-a-service": the multi-registradora smart routing
// (lib/registradoras.ts) — until now only ever called from inside Lastro's own emissão
// flow (lib/emitirCore.ts) — exposed for the first time to a third party that isn't a
// Lastro cedente. A partner sends its own receivable (never touches the `duplicatas`
// table, never enters the marketplace) and gets back which registradora Lastro's own
// routing chose plus the real registro number — the exact "which registradora, and did
// anyone else already register this" problem every platform has to solve independently
// during the duplicata escritural transition. A 'platform' key can call this too, bundled
// at no extra charge; only a dedicated registro_api key gets billed per call.
v1Router.post(
  '/registro',
  asyncHandler(async (req, res) => {
    const parsed = registroSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    const { referenciaExterna, sacadoCnpj, valor, vencimento } = parsed.data;
    const escolhida = chooseRegistradora(valor);
    let duplicidadeConfirmada: boolean | null = null;
    try {
      const dup = await checkDuplicidadeNaRegistradora(escolhida.key, sacadoCnpj, valor, vencimento);
      duplicidadeConfirmada = dup?.duplicidadeEncontrada ?? null;
    } catch {
      // Same honesty as lib/dupCheck.ts: a failed external check stays null (unknown),
      // never silently reported as "confirmado limpo".
    }
    let registro: string;
    let simulado: boolean;
    try {
      const result = await registrarNaRegistradora({ registradoraKey: escolhida.key, duplicataId: referenciaExterna, valor, sacadoCnpj, vencimento });
      registro = result.registro;
      simulado = result.simulado;
    } catch (err) {
      if (err instanceof RegistroIndisponivelError) {
        res.status(503).json({ error: 'registradora_indisponivel', message: 'A registradora escolhida está indisponível no momento — tente novamente.' });
        return;
      }
      throw err;
    }
    if (req.apiKey!.product === 'registro_api') {
      await chargePerCall(req.apiUser!.id, 'registro_api', `Registro via API — ref. ${referenciaExterna}, registro ${registro} (${escolhida.name})`);
    }
    res.json({
      referenciaExterna,
      registradora: escolhida.name,
      registro,
      simulado,
      duplicidadeConfirmada,
    });
  })
);

const judicialConsultaSchema = z.object({ cnpj: z.string().trim().min(11).max(20) });

// Feature "Judicial Records API" — the exact same real-when-configured provider adapter
// lib/complianceEngine.ts already reads internally (JUDICIAL_RECORDS_API_URL/KEY), exposed
// standalone for the first time. Honestly 503s (never charges, never fabricates a clean
// result) when no commercial provider is configured — no free public equivalent exists in
// Brazil, same disclosed limitation as lib/judicialRecords.ts's internal use.
v1Router.post(
  '/judicial/consulta',
  asyncHandler(async (req, res) => {
    const parsed = judicialConsultaSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    if (!judicialRecordsEnabled) {
      res.status(503).json({
        error: 'judicial_records_unavailable',
        message: 'Nenhum provedor de histórico judicial configurado (JUDICIAL_RECORDS_API_URL/KEY) — sem equivalente público gratuito no Brasil.',
      });
      return;
    }
    let result;
    try {
      result = await screenJudicialRecords(parsed.data.cnpj);
    } catch {
      res.status(503).json({ error: 'judicial_records_unavailable', message: 'O provedor de histórico judicial está indisponível no momento — tente novamente.' });
      return;
    }
    if (req.apiKey!.product === 'judicial_records_api') {
      await chargePerCall(req.apiUser!.id, 'judicial_records_api', `Consulta de antecedentes judiciais via API — CNPJ ${parsed.data.cnpj}`);
    }
    res.json({ cnpj: parsed.data.cnpj, ...result });
  })
);

const fraudeAvaliarSchema = z.object({
  cedenteNome: z.string().trim().min(1).max(200),
  sacadoNome: z.string().trim().min(1).max(200),
  valor: z.number().positive().max(50_000_000),
  historicoRecente: z.array(z.object({ sacadoNome: z.string().trim().min(1).max(200), valor: z.number().positive() })).max(200).optional(),
});

// Feature "Fraud Screening API" — see lib/fraudScreeningApi.ts for why this isn't a
// straight reuse of the internal fraud-anomaly scan job. Always available (pure
// computation over what the caller sends, no external provider), so this is the one new
// product here that never 503s.
v1Router.post(
  '/fraude/avaliar',
  asyncHandler(async (req, res) => {
    const parsed = fraudeAvaliarSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    const result = screenFraudSignals(parsed.data);
    if (req.apiKey!.product === 'fraud_screening_api') {
      await chargePerCall(req.apiUser!.id, 'fraud_screening_api', `Avaliação de fraude via API — cedente ${parsed.data.cedenteNome}`);
    }
    res.json(result);
  })
);

const documentosAnalisarSchema = z.object({
  tipo: z.enum(['contrato', 'nfe']),
  arquivoBase64: z.string().min(1),
  mimeType: z.enum(['application/pdf', 'application/xml', 'text/xml', 'image/png', 'image/jpeg']),
});

// Feature "Document Intelligence API" — the same real Claude-vision document reads
// lib/contractAnalysis.ts and lib/nfeExtraction.ts already do for Lastro's own uploads
// (routes/uploads.ts), exposed standalone. Both take a file *path* (they read it off disk
// themselves), so the base64 body is written to a throwaway temp file for the duration of
// the call and always cleaned up in `finally` — no upload is ever persisted here. Honestly
// 503s (never charges) when ANTHROPIC_API_KEY isn't configured, same as every internal
// caller of these two functions.
v1Router.post(
  '/documentos/analisar',
  requireWriteScope,
  asyncHandler(async (req, res) => {
    const parsed = documentosAnalisarSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    if (!claudeEnabled) {
      res.status(503).json({ error: 'document_intelligence_unavailable', message: 'ANTHROPIC_API_KEY não configurado — análise de documentos desativada.' });
      return;
    }
    const { tipo, arquivoBase64, mimeType } = parsed.data;
    let buffer: Buffer;
    try {
      buffer = Buffer.from(arquivoBase64, 'base64');
    } catch {
      res.status(400).json({ error: 'validation_error', message: 'arquivoBase64 não é um Base64 válido.' });
      return;
    }
    const tmpPath = path.join(os.tmpdir(), `v1-doc-${crypto.randomUUID()}`);
    try {
      await fs.writeFile(tmpPath, buffer);
      const resultado = tipo === 'contrato' ? await analyzeContract(tmpPath, mimeType, req.apiUser!.id) : await extractNfeFields(tmpPath, mimeType, req.apiUser!.id);
      if (!resultado) {
        res.status(503).json({ error: 'document_intelligence_unavailable', message: 'Não foi possível analisar o documento no momento — tente novamente.' });
        return;
      }
      if (req.apiKey!.product === 'document_intelligence_api') {
        await chargePerCall(req.apiUser!.id, 'document_intelligence_api', `Análise de documento (${tipo}) via API`);
      }
      res.json({ tipo, resultado });
    } finally {
      await fs.unlink(tmpPath).catch(() => {});
    }
  })
);

const conciliacaoSchema = z.object({
  ofxContent: z.string().min(1),
  esperado: z.array(z.object({ referencia: z.string().trim().min(1).max(120), valor: z.number().positive(), data: z.string().trim().min(8).max(10) })).max(1000),
});

// Feature "Reconciliation API" — see lib/reconciliationApi.ts for why this generalizes
// (rather than reuses) lib/bankStatementReconciliation.ts's internal ledger-matching.
// Always available (no external provider — the caller supplies both sides), so this never
// 503s; a malformed OFX file is a 400, not a 503, since it's the caller's own input.
v1Router.post(
  '/conciliacao',
  requireWriteScope,
  asyncHandler(async (req, res) => {
    const parsed = conciliacaoSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    let result;
    try {
      result = reconcileAgainstExpected(parsed.data.ofxContent, parsed.data.esperado);
    } catch (err) {
      if (err instanceof OfxParseError) {
        res.status(400).json({ error: 'ofx_parse_error', message: err.message });
        return;
      }
      throw err;
    }
    if (req.apiKey!.product === 'reconciliation_api') {
      await chargePerCall(req.apiUser!.id, 'reconciliation_api', `Conciliação bancária via API — ${result.transacoesNoExtrato} transação(ões) no extrato`);
    }
    res.json(result);
  })
);

const suitabilityAvaliarSchema = z.object({ answers: z.record(z.string(), z.string()) });

// Feature "Suitability-as-a-Service" — the same CVM-style scoring lib/suitability.ts
// already runs for Lastro's own investors, exposed stateless: scores the caller's own end
// customer without touching Lastro's `suitability` table (there is no Lastro user to
// attach a result to). Always available (deterministic, no external provider).
v1Router.post(
  '/suitability/avaliar',
  asyncHandler(async (req, res) => {
    const parsed = suitabilityAvaliarSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    const scored = scoreAnswers(parsed.data.answers);
    if (scored.status === 400) {
      res.status(400).json(scored.body);
      return;
    }
    if (req.apiKey!.product === 'suitability_api') {
      await chargePerCall(req.apiUser!.id, 'suitability_api', 'Avaliação de suitability via API');
    }
    res.json({ score: scored.score, maxScore: MAX_SCORE, profile: scored.profile, profileLabel: PROFILE_LABEL[scored.profile] });
  })
);

// Feature "Lastro Index" — see lib/marketIndex.ts. Always available (Lastro's own
// aggregated data, no external provider), and the one new product here billed on a GET.
v1Router.get(
  '/index',
  asyncHandler(async (req, res) => {
    const index = buildMarketIndex();
    if (req.apiKey!.product === 'market_index_api') {
      await chargePerCall(req.apiUser!.id, 'market_index_api', 'Consulta ao Lastro Index via API');
    }
    res.json(index);
  })
);
