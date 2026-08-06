import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { approveKyb, listPendingKyb, rejectKyb } from '../db/users.js';
import { getDispute, listAllOpenDisputes, listEvents, resolveDispute } from '../db/disputes.js';
import { getAceite, setAceiteStatus } from '../db/aceites.js';
import { getDuplicata, setStatus as setDuplicataStatus } from '../db/duplicatas.js';
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
