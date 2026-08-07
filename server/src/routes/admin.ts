import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { approveKyb, listPendingKyb, rejectKyb } from '../db/users.js';
import { getDispute, listAllOpenDisputes, listEvents, resolveDispute } from '../db/disputes.js';
import { getAceite, setAceiteStatus } from '../db/aceites.js';
import { getDuplicata, listOverdueDuplicatas, setStatus as setDuplicataStatus } from '../db/duplicatas.js';
import { addNotification } from '../db/misc.js';
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

export const adminRouter = Router();
adminRouter.use(requireAuth, requireRole('admin'));

adminRouter.get('/kyb', (_req, res) => {
  const pending = listPendingKyb().map((u) => ({
    id: u.id,
    nome: u.nome,
    email: u.email,
    companyName: u.company_name,
    kybForm: JSON.parse(u.kyb_form || '{}'),
    submittedAt: fmtRelative(u.created_at),
    pldStatus: u.pld_status,
    pldMatchNote: u.pld_match_note,
  }));
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
