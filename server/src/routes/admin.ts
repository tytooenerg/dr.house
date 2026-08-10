import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { approveKyb, listPendingKyb, rejectKyb, getUserById } from '../db/users.js';
import { getDispute, listAllOpenDisputes, listEvents, resolveDispute } from '../db/disputes.js';
import { getAceite, setAceiteStatus } from '../db/aceites.js';
import { getDuplicata, listOverdueDuplicatas, setStatus as setDuplicataStatus } from '../db/duplicatas.js';
import { addNotification, addLedgerEntry } from '../db/misc.js';
import { recordAuditEvent, listAuditLog, verifyAuditChain } from '../db/audit.js';
import { COLORS } from '../data/seed.js';
import { fmtBRL, fmtRelative } from '../lib/format.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { summarizeDispute } from '../lib/disputeCopilot.js';
import { listPendingComplianceReview, resolveComplianceReview, type ComplianceBreakdownItem } from '../db/complianceEngine.js';
import { aiFeatureLimiter } from '../lib/aiRateLimit.js';
import { getClaudeUsageSummary } from '../db/claudeUsage.js';
import { getSuspendThreshold, setSuspendThreshold, DEFAULT_SUSPEND_THRESHOLD } from '../lib/complianceEngine.js';
import { checkCollectionEligibility, generateCollectionDraft, LEGAL_DRAFT_DISCLAIMER, type CollectionDocType } from '../lib/legalCollection.js';
import { generateLegalDraft, type LegalDraftType } from '../lib/legalDraftGenerator.js';
import { analyzeRegulatoryText } from '../lib/regulatoryMonitor.js';
import {
  recordLegalDocument,
  listLegalDocumentsByDuplicata,
  listGeneralLegalDocuments,
  getLegalDocument,
  markLegalDocumentReviewed,
} from '../db/legalDocuments.js';
import { recordRegulatoryNote, listRegulatoryNotes, acknowledgeRegulatoryNote } from '../db/regulatoryNotes.js';
import { getSuccessFeePct, setSuccessFeePct, DEFAULT_SUCCESS_FEE_PCT, recordRecovery } from '../lib/legalCollectionFee.js';
import { listAllLegalCollectionFees } from '../db/legalCollectionFees.js';
import { runBackup, listBackups, backupEnabled } from '../lib/backup.js';
import { listPendingTedDeposits, getTedDeposit, concludeTedDeposit } from '../db/ted.js';
import {
  listSuspiciousActivityReports,
  getSuspiciousActivityReport,
  dismissSuspiciousActivityReport,
  markSuspiciousActivityReported,
} from '../db/suspiciousActivity.js';
import { runSuspiciousActivityScan, getStructuringThreshold, setStructuringThreshold } from '../lib/suspiciousActivityMonitor.js';
import { generateAndRecordEligibility } from '../lib/foreignInvestorCompliance.js';
import { listForeignInvestorScreeningsByUser } from '../db/foreignInvestorScreenings.js';
import { getAddOnPrice, setAddOnPrice, getAddOnDefaultPrice } from '../lib/addOnBilling.js';
import { sumAddOnChargesByKind, listRecentAddOnCharges, type AddOnKind } from '../db/addOnCharges.js';
import { getIncludedCallsPerMonth, setIncludedCallsPerMonth, runApiOverageBilling } from '../lib/apiOverageBilling.js';
import { runWhitelabelPlusBilling } from '../lib/whitelabelBilling.js';
import { runInstitutionalReportingBilling } from '../lib/institutionalReporting.js';
import { getLatestAgentRunForSubject, listPendingActionsForRun } from '../db/agents.js';
import { trainModel, getModel, MIN_TRAINING_SAMPLES } from '../lib/mlScoring.js';
import { runFraudAnomalyScan } from '../lib/fraudAnomalyDetection.js';
import { computeMetrics } from '../lib/metrics.js';
import { listFeatureFlagViews, setFeatureFlag } from '../lib/featureFlags.js';
import { streamCoafReportPdf, buildCvmPeriodStats, streamCvmReportPdf } from '../lib/regulatoryReports.js';

const ADDON_KINDS: AddOnKind[] = ['api_overage', 'score_api', 'pld_screening_api', 'whitelabel_plus', 'institutional_reporting'];

export const adminRouter = Router();
adminRouter.use(requireAuth, requireRole('admin'));

// Surfaces the Onboarding agent's pre-triage (auto-triggered on KYB submission — see
// routes/auth.ts POST /kyb) instead of making the admin re-run it: the most recent run
// against this user, plus whether it already proposed an aprovar_kyb/rejeitar_kyb pending
// action the admin can act on directly from this queue. Returns null when no run exists
// yet (ANTHROPIC_API_KEY wasn't configured at submission time, or it's still running).
function buildAiTriage(userId: number) {
  const run = getLatestAgentRunForSubject('onboarding', 'user', String(userId));
  if (!run) return null;
  const pending = listPendingActionsForRun(run.id).find(
    (p) => p.status === 'pendente' && (p.tool_name === 'aprovar_kyb' || p.tool_name === 'rejeitar_kyb')
  );
  return {
    runId: run.id,
    status: run.status,
    summary: run.summary,
    pendingActionId: pending?.id ?? null,
    pendingActionTool: (pending?.tool_name as 'aprovar_kyb' | 'rejeitar_kyb' | undefined) ?? null,
  };
}

adminRouter.get('/kyb', (_req, res) => {
  const pending = listPendingKyb().map((u) => {
    const kybForm = JSON.parse(u.kyb_form || '{}');
    return {
      id: u.id,
      nome: u.nome,
      email: u.email,
      companyName: u.company_name,
      kybForm,
      naoResidente: !!kybForm.naoResidente,
      submittedAt: fmtRelative(u.created_at),
      pldStatus: u.pld_status,
      pldMatchNote: u.pld_match_note,
      aiTriage: buildAiTriage(u.id),
    };
  });
  res.json({ pending });
});

adminRouter.post(
  '/kyb/:userId/approve',
  asyncHandler(async (req, res) => {
    const userId = Number(req.params.userId);
    approveKyb(userId);
    recordAuditEvent(req.user!.id, req.user!.company_name, 'kyb.approved', { targetUserId: userId });
    res.json({ ok: true });
  })
);

const rejectSchema = z.object({ reason: z.string().trim().min(3, 'Informe o motivo da rejeição.') });

adminRouter.post(
  '/kyb/:userId/reject',
  asyncHandler(async (req, res) => {
    const parsed = rejectSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    const userId = Number(req.params.userId);
    rejectKyb(userId, parsed.data.reason);
    recordAuditEvent(req.user!.id, req.user!.company_name, 'kyb.rejected', { targetUserId: userId, reason: parsed.data.reason });
    res.json({ ok: true });
  })
);

// Foreign investor (INR) eligibility memo — on-demand, admin-triggered, deterministic
// (see lib/foreignInvestorCompliance.ts). Generating one doesn't approve or reject the
// KYB by itself; it's a compliance record the admin reviews alongside the normal
// approve/reject decision above.
adminRouter.get('/kyb/:userId/elegibilidade-estrangeiro', (req, res) => {
  const screenings = listForeignInvestorScreeningsByUser(Number(req.params.userId)).map((s) => ({
    id: s.id,
    paisDomicilio: s.pais_domicilio,
    jurisdicaoFavorecida: !!s.jurisdicao_favorecida,
    classificacao: s.classificacao_investidor,
    representanteLegal: s.representante_legal,
    pldStatus: s.pld_status,
    pldDetail: s.pld_detail,
    memo: s.memo,
    quando: fmtRelative(s.created_at),
  }));
  res.json({ screenings });
});

adminRouter.post(
  '/kyb/:userId/elegibilidade-estrangeiro/gerar',
  asyncHandler(async (req, res) => {
    const userId = Number(req.params.userId);
    const target = getUserById(userId);
    if (!target) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const row = await generateAndRecordEligibility(target, req.user!.id);
    res.json({
      screening: {
        id: row.id,
        paisDomicilio: row.pais_domicilio,
        jurisdicaoFavorecida: !!row.jurisdicao_favorecida,
        classificacao: row.classificacao_investidor,
        representanteLegal: row.representante_legal,
        pldStatus: row.pld_status,
        pldDetail: row.pld_detail,
        memo: row.memo,
        quando: fmtRelative(row.created_at),
      },
    });
  })
);

adminRouter.get('/disputes', (_req, res) => {
  const disputes = listAllOpenDisputes().map((d) => ({
    id: d.id,
    duplicataId: d.duplicata_id,
    sacado: d.sacado_nome,
    cedente: d.cedente_nome,
    valorFmt: fmtBRL(d.valor),
    motivo: d.motivo,
    timeline: listEvents(d.id).map((e) => ({ autor: e.autor, texto: e.texto, quando: fmtRelative(e.created_at) })),
  }));
  res.json({ disputes });
});

// Copilot: summarizes the dispute + suggests a verdict for the admin to review before
// deciding — never applied automatically. Returns null (not a fabricated recommendation)
// when ANTHROPIC_API_KEY isn't set.
adminRouter.get(
  '/disputes/:id/ai-summary',
  aiFeatureLimiter,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const dispute = getDispute(id);
    if (!dispute) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const all = listAllOpenDisputes().find((d) => d.id === id);
    if (!all) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const timeline = listEvents(id).map((e) => ({ autor: e.autor, texto: e.texto, quando: fmtRelative(e.created_at) }));
    const summary = await summarizeDispute({ motivo: all.motivo, sacado: all.sacado_nome, cedente: all.cedente_nome, valorFmt: fmtBRL(all.valor), timeline }, req.user!.id);
    res.json({ summary });
  })
);

const arbitrateSchema = z.object({ decision: z.enum(['cedente', 'sacado']), note: z.string().trim().min(1) });

adminRouter.post(
  '/disputes/:id/resolve',
  asyncHandler(async (req, res) => {
    const parsed = arbitrateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    const id = Number(req.params.id);
    const dispute = getDispute(id);
    if (!dispute) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    resolveDispute(id, `${parsed.data.decision}: ${parsed.data.note}`, req.user!.id);
    const aceite = getAceite(dispute.aceite_id);
    if (aceite) {
      if (parsed.data.decision === 'cedente') setAceiteStatus(aceite.id, 'aceita');
      const duplicata = getDuplicata(aceite.duplicata_id);
      if (duplicata?.cedente_id) {
        const verdict = parsed.data.decision === 'cedente' ? 'a favor do cedente' : 'a favor do sacado';
        addNotification(duplicata.cedente_id, `Arbitragem da disputa em ${duplicata.id} decidida ${verdict}: ${parsed.data.note}`, COLORS.NAVY, 'disputa');
      }
    }
    recordAuditEvent(req.user!.id, req.user!.company_name, 'dispute.resolved', { disputeId: id, decision: parsed.data.decision });
    res.json({ ok: true });
  })
);

// Compliance AI Engine queue — duplicatas the engine suspended (score >= threshold, see
// lib/complianceEngine.ts) instead of letting reach the marketplace automatically. Always
// a human decides here: liberar (back to 'aprovada', cedente can then disparar leilão
// normally) or rejeitar (terminal, cedente is notified) — never an automatic block.
adminRouter.get('/compliance-queue', (_req, res) => {
  const pending = listPendingComplianceReview().map((r) => ({
    duplicataId: r.duplicata_id,
    sacado: r.sacado_nome,
    cedente: r.cedente_nome,
    valorFmt: fmtBRL(r.valor),
    vencimento: r.vencimento,
    score: r.score,
    breakdown: JSON.parse(r.breakdown_json) as ComplianceBreakdownItem[],
    reasoning: r.reasoning,
    quando: fmtRelative(r.created_at),
  }));
  res.json({ pending });
});

const complianceReviewSchema = z.object({ decision: z.enum(['liberado', 'rejeitado']), note: z.string().trim().min(1) });

adminRouter.post(
  '/compliance-queue/:duplicataId/decidir',
  asyncHandler(async (req, res) => {
    const parsed = complianceReviewSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    const duplicata = getDuplicata(req.params.duplicataId);
    if (!duplicata || duplicata.status !== 'suspensa_compliance') {
      res.status(404).json({ error: 'not_found', message: 'Duplicata não encontrada ou já revisada.' });
      return;
    }
    resolveComplianceReview(duplicata.id, parsed.data.decision, parsed.data.note, req.user!.id);
    setDuplicataStatus(duplicata.id, parsed.data.decision === 'liberado' ? 'aprovada' : 'rejeitada');
    if (duplicata.cedente_id) {
      const msg =
        parsed.data.decision === 'liberado'
          ? `Sua duplicata ${duplicata.id} passou pela revisão de compliance e está liberada para leilão.`
          : `Sua duplicata ${duplicata.id} foi rejeitada na revisão de compliance: ${parsed.data.note}`;
      addNotification(duplicata.cedente_id, msg, parsed.data.decision === 'liberado' ? COLORS.GREEN : COLORS.RED, 'disputa');
    }
    recordAuditEvent(req.user!.id, req.user!.company_name, 'duplicata.compliance_revisada', {
      duplicataId: duplicata.id,
      decision: parsed.data.decision,
    });
    res.json({ ok: true });
  })
);

// Cost/abuse visibility for every Claude-calling feature (see lib/claude.ts, which logs
// one row per real API call with the token counts the API itself returned). The cost
// figure is an estimate off a configurable per-token rate (db/claudeUsage.ts) — useful to
// spot a feature/user driving unexpected spend, not a substitute for the Anthropic
// console's actual invoice.
adminRouter.get('/ai-usage', (_req, res) => {
  res.json(getClaudeUsageSummary());
});

// Real trained scoring model (lib/mlScoring.ts) backing the Underwriting agent's
// prever_probabilidade_ml tool and the standalone Score API product. Status is always
// available even with no model yet, so the panel can explain why (dados insuficientes)
// instead of just looking broken.
adminRouter.get('/ml-scoring', (_req, res) => {
  const model = getModel();
  res.json({
    minTrainingSamples: MIN_TRAINING_SAMPLES,
    model: model
      ? { nSamples: model.nSamples, nPositive: model.nPositive, trainAccuracy: model.trainAccuracy, trainedAt: model.trainedAt, featureNames: model.featureNames, weights: model.weights }
      : null,
  });
});

adminRouter.post('/ml-scoring/retrain', (req, res) => {
  const result = trainModel();
  recordAuditEvent(req.user!.id, req.user!.company_name, 'ml_scoring.retrain', { trained: result.trained, reason: result.reason ?? null });
  res.json(result);
});

// Computed fresh on every call (lib/fraudAnomalyDetection.ts) — always reflects the
// current book, never a stale cached verdict.
adminRouter.get('/fraud-anomalies', (_req, res) => {
  res.json({ findings: runFraudAnomalyScan() });
});

// Real per-route latency (p50/p95) and error rate from this process's own request history
// (lib/metrics.ts) — in-memory only, resets on restart, honestly labeled as such rather
// than pretending to be a durable APM.
adminRouter.get('/metrics', (req, res) => {
  const windowMinutes = Math.max(1, Math.min(1440, Number(req.query.windowMinutes) || 60));
  res.json(computeMetrics(windowMinutes));
});

// Compliance AI Engine's auto-suspend bar (see lib/complianceEngine.ts) — admin-tunable
// instead of a hardcoded constant, so it can be tightened/loosened as real false
// positive/negative rates become clear, without a code deploy. Only ever changes where the
// line for "suspend for human review" sits; suspended items still always need a human
// liberar/rejeitar decision (see /compliance-queue above) — this never makes the decision
// itself automatic.
adminRouter.get('/compliance-threshold', (_req, res) => {
  res.json({ threshold: getSuspendThreshold(), default: DEFAULT_SUSPEND_THRESHOLD });
});

const thresholdSchema = z.object({ threshold: z.number().int().min(1).max(100) });

adminRouter.put(
  '/compliance-threshold',
  asyncHandler(async (req, res) => {
    const parsed = thresholdSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    setSuspendThreshold(parsed.data.threshold, req.user!.id);
    recordAuditEvent(req.user!.id, req.user!.company_name, 'compliance.threshold_updated', { threshold: parsed.data.threshold });
    res.json({ threshold: parsed.data.threshold });
  })
);

// --- Jurídico: cobrança jurídica -------------------------------------------------------
// A duplicata escritural is a título executivo extrajudicial (Lei 5.474/68 art. 15 c/c
// CPC art. 784, I) — a real ação de execução can be filed directly against an
// inadimplente sacado. This surfaces overdue duplicatas eligible for that escalation and
// drafts the documents it needs (lib/legalCollection.ts). Every draft is explicitly a
// draft — LEGAL_DRAFT_DISCLAIMER is attached deterministically to every response and
// stored copy, never left to the LLM to remember — and nothing here files, sends or
// protocols anything; an advogado inscrito na OAB must review and sign first.
const COLLECTION_DOC_TYPES: CollectionDocType[] = ['notificacao_cobranca', 'minuta_protesto', 'peticao_execucao'];

adminRouter.get('/juridico/cobranca', (_req, res) => {
  const overdue = listOverdueDuplicatas().map((d) => {
    const eligibility = checkCollectionEligibility(d);
    return {
      duplicataId: d.id,
      sacado: d.sacado_nome,
      cedente: d.cedente_nome,
      valor: d.valor,
      valorFmt: fmtBRL(d.valor),
      vencimento: d.vencimento,
      eligible: eligibility.eligible,
      reason: eligibility.reason ?? null,
      diasEmAtraso: eligibility.diasEmAtraso,
      documentos: listLegalDocumentsByDuplicata(d.id).map((doc) => ({
        id: doc.id,
        type: doc.type,
        content: doc.content,
        reviewed: !!doc.reviewed,
        quando: fmtRelative(doc.created_at),
      })),
    };
  });
  res.json({ overdue, disclaimer: LEGAL_DRAFT_DISCLAIMER, feePct: getSuccessFeePct() });
});

// Success fee (lib/legalCollectionFee.ts) — admin-configurable %, charged only once a
// duplicata escalated here is actually recovered. See GET/PUT below and POST .../recuperar.
adminRouter.get('/juridico/cobranca-fee', (_req, res) => {
  res.json({ feePct: getSuccessFeePct(), default: DEFAULT_SUCCESS_FEE_PCT });
});

adminRouter.get('/juridico/recuperacoes', (_req, res) => {
  const recuperacoes = listAllLegalCollectionFees().map((r) => ({
    duplicataId: r.duplicata_id,
    sacado: r.sacado_nome,
    cedente: r.cedente_nome,
    recoveredValorFmt: fmtBRL(r.recovered_valor),
    feeValorFmt: fmtBRL(r.fee_valor),
    feePct: r.fee_pct,
    chargedRole: r.charged_role,
    quando: fmtRelative(r.created_at),
  }));
  res.json({ recuperacoes });
});

const feePctSchema = z.object({ feePct: z.number().min(0).max(50) });

adminRouter.put(
  '/juridico/cobranca-fee',
  asyncHandler(async (req, res) => {
    const parsed = feePctSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    setSuccessFeePct(parsed.data.feePct, req.user!.id);
    recordAuditEvent(req.user!.id, req.user!.company_name, 'juridico.fee_atualizado', { feePct: parsed.data.feePct });
    res.json({ feePct: parsed.data.feePct });
  })
);

const recuperarSchema = z.object({ valorRecuperado: z.number().positive().optional() });

adminRouter.post(
  '/juridico/cobranca/:duplicataId/recuperar',
  asyncHandler(async (req, res) => {
    const parsed = recuperarSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    const duplicata = getDuplicata(req.params.duplicataId);
    if (!duplicata) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const eligibility = checkCollectionEligibility(duplicata);
    if (!eligibility.eligible) {
      res.status(409).json({ error: 'not_eligible', message: eligibility.reason });
      return;
    }
    const result = recordRecovery(duplicata, parsed.data.valorRecuperado ?? duplicata.valor, req.user!.id);
    if (!result) {
      res.status(409).json({ error: 'already_recovered', message: 'Esta duplicata já teve uma recuperação registrada.' });
      return;
    }
    const msg = `Duplicata ${duplicata.id} recuperada via cobrança jurídica — fee de sucesso de ${fmtBRL(result.feeValor)} (${result.feePct}%) debitado.`;
    addNotification(result.chargedTo.userId, msg, COLORS.NAVY, 'disputa');
    recordAuditEvent(req.user!.id, req.user!.company_name, 'juridico.recuperacao_registrada', {
      duplicataId: duplicata.id,
      feeValor: result.feeValor,
      feePct: result.feePct,
      chargedTo: result.chargedTo,
    });
    res.json({ ok: true, feeValor: result.feeValor, feePct: result.feePct, chargedRole: result.chargedTo.role });
  })
);

adminRouter.post(
  '/juridico/cobranca/:duplicataId/:tipo',
  aiFeatureLimiter,
  asyncHandler(async (req, res) => {
    const tipo = req.params.tipo as CollectionDocType;
    if (!COLLECTION_DOC_TYPES.includes(tipo)) {
      res.status(400).json({ error: 'validation_error', message: 'Tipo de documento inválido.' });
      return;
    }
    const duplicata = getDuplicata(req.params.duplicataId);
    if (!duplicata) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const eligibility = checkCollectionEligibility(duplicata);
    if (!eligibility.eligible) {
      res.status(409).json({ error: 'not_eligible', message: eligibility.reason });
      return;
    }
    const draft = await generateCollectionDraft(duplicata, tipo, req.user!.id);
    if (!draft) {
      res.status(503).json({ error: 'ai_unavailable', message: 'IA indisponível no momento (ANTHROPIC_API_KEY não configurada ou a chamada falhou).' });
      return;
    }
    const content = `${draft}\n\n---\n${LEGAL_DRAFT_DISCLAIMER}`;
    const doc = recordLegalDocument({ type: tipo, duplicataId: duplicata.id, content, generatedBy: req.user!.id });
    recordAuditEvent(req.user!.id, req.user!.company_name, 'juridico.cobranca_gerada', { duplicataId: duplicata.id, tipo });
    res.status(201).json({ id: doc.id, type: doc.type, content: doc.content, reviewed: false });
  })
);

// --- Jurídico: minutas gerais -----------------------------------------------------------
const LEGAL_DRAFT_TYPES: LegalDraftType[] = ['resposta_lgpd', 'termos_atualizacao', 'notificacao_padrao'];
const legalDraftSchema = z.object({ type: z.enum(['resposta_lgpd', 'termos_atualizacao', 'notificacao_padrao']), context: z.string().trim().min(5) });

adminRouter.get('/juridico/minutas', (_req, res) => {
  const documentos = listGeneralLegalDocuments().map((doc) => ({
    id: doc.id,
    type: doc.type,
    content: doc.content,
    reviewed: !!doc.reviewed,
    quando: fmtRelative(doc.created_at),
  }));
  res.json({ documentos, disclaimer: LEGAL_DRAFT_DISCLAIMER });
});

adminRouter.post(
  '/juridico/minutas',
  aiFeatureLimiter,
  asyncHandler(async (req, res) => {
    const parsed = legalDraftSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    if (!LEGAL_DRAFT_TYPES.includes(parsed.data.type)) {
      res.status(400).json({ error: 'validation_error', message: 'Tipo de minuta inválido.' });
      return;
    }
    const draft = await generateLegalDraft(parsed.data.type, parsed.data.context, req.user!.id);
    if (!draft) {
      res.status(503).json({ error: 'ai_unavailable', message: 'IA indisponível no momento (ANTHROPIC_API_KEY não configurada ou a chamada falhou).' });
      return;
    }
    const content = `${draft}\n\n---\n${LEGAL_DRAFT_DISCLAIMER}`;
    const doc = recordLegalDocument({ type: parsed.data.type, content, generatedBy: req.user!.id });
    recordAuditEvent(req.user!.id, req.user!.company_name, 'juridico.minuta_gerada', { tipo: parsed.data.type });
    res.status(201).json({ id: doc.id, type: doc.type, content: doc.content, reviewed: false });
  })
);

adminRouter.post(
  '/juridico/documentos/:id/revisar',
  asyncHandler(async (req, res) => {
    const doc = getLegalDocument(Number(req.params.id));
    if (!doc) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    markLegalDocumentReviewed(doc.id, req.user!.id);
    recordAuditEvent(req.user!.id, req.user!.company_name, 'juridico.documento_revisado', { documentId: doc.id, type: doc.type });
    res.json({ ok: true });
  })
);

// --- Jurídico: monitor regulatório -------------------------------------------------------
// An admin pastes the real normative text (resolução, circular etc.); Claude summarizes
// it and flags impact areas for the admin to decide what, if anything, needs to change.
// Nothing here polls BACEN/CVM/COAF automatically — see lib/regulatoryMonitor.ts.
const regulatorySchema = z.object({ title: z.string().trim().min(3), sourceText: z.string().trim().min(20) });

adminRouter.get('/juridico/regulatorio', (_req, res) => {
  const notes = listRegulatoryNotes().map((n) => ({
    id: n.id,
    title: n.title,
    summary: n.summary,
    impactAreas: JSON.parse(n.impact_areas_json) as string[],
    recommendedActions: n.recommended_actions,
    acknowledged: !!n.acknowledged,
    quando: fmtRelative(n.created_at),
  }));
  res.json({ notes });
});

adminRouter.post(
  '/juridico/regulatorio',
  aiFeatureLimiter,
  asyncHandler(async (req, res) => {
    const parsed = regulatorySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    const analysis = await analyzeRegulatoryText(parsed.data.title, parsed.data.sourceText, req.user!.id);
    if (!analysis) {
      res.status(503).json({ error: 'ai_unavailable', message: 'IA indisponível no momento (ANTHROPIC_API_KEY não configurada ou a chamada falhou).' });
      return;
    }
    const note = recordRegulatoryNote({
      title: parsed.data.title,
      sourceText: parsed.data.sourceText,
      summary: analysis.summary,
      impactAreas: analysis.impactAreas,
      recommendedActions: analysis.recommendedActions,
      submittedBy: req.user!.id,
    });
    recordAuditEvent(req.user!.id, req.user!.company_name, 'juridico.normativo_analisado', { noteId: note.id, title: parsed.data.title });
    res.status(201).json({
      id: note.id,
      title: note.title,
      summary: note.summary,
      impactAreas: analysis.impactAreas,
      recommendedActions: note.recommended_actions,
      acknowledged: false,
    });
  })
);

adminRouter.post(
  '/juridico/regulatorio/:id/reconhecer',
  asyncHandler(async (req, res) => {
    acknowledgeRegulatoryNote(Number(req.params.id), req.user!.id);
    recordAuditEvent(req.user!.id, req.user!.company_name, 'juridico.normativo_reconhecido', { noteId: Number(req.params.id) });
    res.json({ ok: true });
  })
);

adminRouter.get('/audit', (_req, res) => {
  const entries = listAuditLog(200).map((e) => ({
    id: e.id,
    actor: e.actor_label,
    action: e.action,
    payload: JSON.parse(e.payload),
    hash: e.hash.slice(0, 12),
    quando: fmtRelative(e.created_at),
  }));
  res.json({ entries, chain: verifyAuditChain() });
});

// TED deposits have no self-service confirmation (see lib/tedRail.ts) — an admin matches
// each pending reference against the real bank statement by hand, same as ops would at
// any fintech without a BaaS virtual-account product providing an automatic webhook.
adminRouter.get('/ted/pendentes', (_req, res) => {
  const pendentes = listPendingTedDeposits().map((t) => ({
    referencia: t.referencia,
    empresa: t.company_name,
    valorFmt: fmtBRL(t.valor),
    banco: t.banco,
    agencia: t.agencia,
    conta: t.conta,
    quando: fmtRelative(t.created_at),
  }));
  res.json({ pendentes });
});

adminRouter.post('/ted/:referencia/confirmar', (req, res) => {
  const deposito = getTedDeposit(req.params.referencia);
  if (!deposito) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  if (deposito.status !== 'ativo') {
    res.status(409).json({ error: 'already_settled' });
    return;
  }
  concludeTedDeposit(deposito.referencia, req.user!.id);
  addLedgerEntry(deposito.user_id, new Date().toLocaleDateString('pt-BR'), `Depósito via TED confirmado (ref. ${deposito.referencia})`, deposito.valor);
  recordAuditEvent(req.user!.id, req.user!.company_name, 'admin.ted_confirmado', { referencia: deposito.referencia, valor: deposito.valor });
  res.json({ ok: true });
});

// Automated suspicious-activity monitoring (lib/suspiciousActivityMonitor.ts) — real,
// deterministic detection (fracionamento, entrada/saída rápida); real submission to
// COAF requires a licensed institution's SISCOAP credentials this repo can't have, so an
// admin either dismisses a flagged report or records that they reported it externally.
adminRouter.get('/pld/suspeitas', (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const reports = listSuspiciousActivityReports(status as 'aberto' | 'descartado' | 'reportado_coaf' | undefined).map((r) => ({
    id: r.id,
    empresa: r.company_name,
    email: r.email,
    tipo: r.tipo,
    severidade: r.severidade,
    descricao: r.descricao,
    status: r.status,
    externalReference: r.external_reference,
    quando: fmtRelative(r.created_at),
  }));
  res.json({ reports, threshold: getStructuringThreshold() });
});

adminRouter.post('/pld/suspeitas/scan', (req, res) => {
  const result = runSuspiciousActivityScan();
  recordAuditEvent(req.user!.id, req.user!.company_name, 'admin.sar_scan_manual', result);
  res.json({ ok: true, ...result });
});

const sarThresholdSchema = z.object({ threshold: z.number().positive().max(10_000_000) });

adminRouter.put(
  '/pld/suspeitas/threshold',
  asyncHandler(async (req, res) => {
    const parsed = sarThresholdSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    setStructuringThreshold(parsed.data.threshold, req.user!.id);
    recordAuditEvent(req.user!.id, req.user!.company_name, 'admin.sar_threshold_updated', { threshold: parsed.data.threshold });
    res.json({ threshold: getStructuringThreshold() });
  })
);

const sarNoteSchema = z.object({ note: z.string().trim().max(500).optional() });

adminRouter.post('/pld/suspeitas/:id/descartar', (req, res) => {
  const report = getSuspiciousActivityReport(Number(req.params.id));
  if (!report) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  if (report.status !== 'aberto') {
    res.status(409).json({ error: 'already_reviewed' });
    return;
  }
  const parsed = sarNoteSchema.safeParse(req.body ?? {});
  dismissSuspiciousActivityReport(report.id, req.user!.id, parsed.success ? parsed.data.note : undefined);
  recordAuditEvent(req.user!.id, req.user!.company_name, 'admin.sar_descartado', { reportId: report.id });
  res.json({ ok: true });
});

const sarReportSchema = z.object({ externalReference: z.string().trim().min(1).max(120), note: z.string().trim().max(500).optional() });

adminRouter.post(
  '/pld/suspeitas/:id/reportar',
  asyncHandler(async (req, res) => {
    const report = getSuspiciousActivityReport(Number(req.params.id));
    if (!report) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    if (report.status !== 'aberto') {
      res.status(409).json({ error: 'already_reviewed' });
      return;
    }
    const parsed = sarReportSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    markSuspiciousActivityReported(report.id, req.user!.id, parsed.data.externalReference, parsed.data.note);
    recordAuditEvent(req.user!.id, req.user!.company_name, 'admin.sar_reportado_coaf', { reportId: report.id, externalReference: parsed.data.externalReference });
    res.json({ ok: true });
  })
);

// Real COAF/CVM report generation (lib/regulatoryReports.ts) — see that file's header
// comment for why this stops at "the correctly-structured document to file manually"
// instead of a real SISCOAF/CVM submission, which needs a licensed institution's own
// government credentials.
adminRouter.get('/pld/suspeitas/:id/relatorio-coaf.pdf', (req, res) => {
  const ok = streamCoafReportPdf(res, Number(req.params.id));
  if (!ok) res.status(404).json({ error: 'not_found' });
});

const cvmPeriodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

function resolveCvmPeriod(raw: unknown): string {
  const parsed = cvmPeriodSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  return new Date().toISOString().slice(0, 7);
}

adminRouter.get('/regulatorio/cvm-informe', (req, res) => {
  const period = resolveCvmPeriod(req.query.period);
  res.json(buildCvmPeriodStats(period));
});

adminRouter.get('/regulatorio/cvm-informe.pdf', (req, res) => {
  const period = resolveCvmPeriod(req.query.period);
  const stats = buildCvmPeriodStats(period);
  recordAuditEvent(req.user!.id, req.user!.company_name, 'admin.cvm_informe_gerado', { period });
  streamCvmReportPdf(res, stats);
});

// Shared config/visibility for the 5 add-on revenue products (lib/addOnBilling.ts) —
// pricing per kind and a combined recent-charges feed, reused across features 1-5.
adminRouter.get('/addons/precos', (_req, res) => {
  const precos = ADDON_KINDS.map((kind) => ({ kind, precoFmt: fmtBRL(getAddOnPrice(kind)), preco: getAddOnPrice(kind), padraoFmt: fmtBRL(getAddOnDefaultPrice(kind)) }));
  res.json({ precos });
});

const addonPriceSchema = z.object({ kind: z.enum(ADDON_KINDS as [AddOnKind, ...AddOnKind[]]), preco: z.number().positive().max(1_000_000) });

adminRouter.put('/addons/precos', (req, res) => {
  const parsed = addonPriceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
    return;
  }
  setAddOnPrice(parsed.data.kind, parsed.data.preco, req.user!.id);
  recordAuditEvent(req.user!.id, req.user!.company_name, 'admin.addon_price_updated', { kind: parsed.data.kind, preco: parsed.data.preco });
  res.json({ kind: parsed.data.kind, preco: getAddOnPrice(parsed.data.kind), precoFmt: fmtBRL(getAddOnPrice(parsed.data.kind)) });
});

adminRouter.get('/addons/cobrancas', (_req, res) => {
  const resumo = ADDON_KINDS.map((kind) => {
    const { total, count } = sumAddOnChargesByKind(kind);
    return { kind, totalFmt: fmtBRL(total), count };
  });
  const recentes = listRecentAddOnCharges(100).map((c) => ({
    id: c.id,
    empresa: c.company_name,
    kind: c.kind,
    quantidade: c.quantity,
    valorFmt: fmtBRL(c.amount),
    descricao: c.description,
    quando: fmtRelative(c.created_at),
  }));
  res.json({ resumo, recentes });
});

// Feature 1: API usage overage billing.
adminRouter.get('/api-overage/config', (_req, res) => {
  res.json({ included: getIncludedCallsPerMonth() });
});

const overageConfigSchema = z.object({ included: z.number().int().positive().max(10_000_000) });

adminRouter.put('/api-overage/config', (req, res) => {
  const parsed = overageConfigSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
    return;
  }
  setIncludedCallsPerMonth(parsed.data.included, req.user!.id);
  recordAuditEvent(req.user!.id, req.user!.company_name, 'admin.api_overage_quota_updated', { included: parsed.data.included });
  res.json({ included: getIncludedCallsPerMonth() });
});

adminRouter.post(
  '/api-overage/cobrar',
  asyncHandler(async (req, res) => {
    const period = typeof req.body?.period === 'string' ? req.body.period : undefined;
    const result = await runApiOverageBilling(period);
    recordAuditEvent(req.user!.id, req.user!.company_name, 'admin.api_overage_cobranca_manual', { ...result });
    res.json(result);
  })
);

// Feature 4: White-label Plus monthly billing — same manual-trigger pattern as
// api-overage/cobrar, for re-running (or force-running early) the 24h background job.
adminRouter.post(
  '/whitelabel-plus/cobrar',
  asyncHandler(async (req, res) => {
    const period = typeof req.body?.period === 'string' ? req.body.period : undefined;
    const result = await runWhitelabelPlusBilling(period);
    recordAuditEvent(req.user!.id, req.user!.company_name, 'admin.whitelabel_plus_cobranca_manual', { ...result });
    res.json(result);
  })
);

// Feature 5: Institutional Reporting monthly billing — same manual-trigger pattern.
adminRouter.post(
  '/institutional-reporting/cobrar',
  asyncHandler(async (req, res) => {
    const period = typeof req.body?.period === 'string' ? req.body.period : undefined;
    const result = await runInstitutionalReportingBilling(period);
    recordAuditEvent(req.user!.id, req.user!.company_name, 'admin.institutional_reporting_cobranca_manual', { ...result });
    res.json(result);
  })
);

adminRouter.get('/backups', (_req, res) => {
  const backups = listBackups().map((b) => ({ ...b, quando: fmtRelative(b.createdAt) }));
  res.json({ enabled: backupEnabled, backups });
});

adminRouter.post(
  '/backups/run',
  asyncHandler(async (req, res) => {
    const backup = await runBackup();
    if (!backup) {
      res.status(409).json({ error: 'backups_disabled' });
      return;
    }
    recordAuditEvent(req.user!.id, req.user!.company_name, 'admin.backup_manual', { filename: backup.filename });
    res.json({ backup: { ...backup, quando: fmtRelative(backup.createdAt) } });
  })
);

// Feature flags — see lib/featureFlags.ts for the registry and every real gate that
// respects these. GET always returns every known flag (even ones never overridden), so
// the panel never has to guess what flags exist.
adminRouter.get('/feature-flags', (_req, res) => {
  res.json({ flags: listFeatureFlagViews() });
});

const featureFlagUpdateSchema = z.object({
  enabled: z.boolean(),
  rolloutPct: z.number().int().min(0).max(100).optional().default(100),
});

adminRouter.post(
  '/feature-flags/:key',
  asyncHandler(async (req, res) => {
    const parsed = featureFlagUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    const flag = setFeatureFlag(req.params.key, parsed.data.enabled, parsed.data.rolloutPct, req.user!.id);
    if (!flag) {
      res.status(404).json({ error: 'not_found', message: 'Flag desconhecida.' });
      return;
    }
    recordAuditEvent(req.user!.id, req.user!.company_name, 'admin.feature_flag_alterada', {
      key: req.params.key,
      enabled: parsed.data.enabled,
      rolloutPct: parsed.data.rolloutPct,
    });
    res.json({ flags: listFeatureFlagViews() });
  })
);
