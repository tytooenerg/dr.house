import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { listInsuredByInsurerKey, listClaimableByInsurerKey, setSinistroStatus } from '../db/duplicatas.js';
import { recordAuditEvent } from '../db/audit.js';
import { addNotification } from '../db/misc.js';
import { INSURERS, COLORS } from '../data/seed.js';
import { fmtBRL } from '../lib/format.js';
import { asyncHandler } from '../lib/asyncHandler.js';

export const seguradoraRouter = Router();
seguradoraRouter.use(requireAuth, requireRole('seguradora'));

function insurerDef(insurerKey: string | null) {
  return INSURERS.find((i) => i.key === insurerKey) ?? null;
}

function payload(req: import('express').Request) {
  const insurer = insurerDef(req.user!.insurer_key);
  const apolices = insurer ? listInsuredByInsurerKey(insurer.key) : [];
  const claimable = insurer ? listClaimableByInsurerKey(insurer.key) : [];
  const totalPremio = apolices.reduce((sum, d) => sum + d.valor * ((insurer?.premioPct ?? 0) / 100), 0);
  const totalSegurado = apolices.reduce((sum, d) => sum + d.valor, 0);

  return {
    insurerName: insurer?.name ?? 'Seguradora não configurada',
    premioPctFmt: insurer?.premioFmt ?? '—',
    totalApolices: apolices.length,
    totalSeguradoFmt: fmtBRL(totalSegurado),
    totalPremioFmt: fmtBRL(totalPremio),
    apolices: apolices.map((d) => ({
      id: d.id,
      cedente: d.cedente_nome,
      sacado: d.sacado_nome,
      valorFmt: fmtBRL(d.valor),
      vencimento: d.vencimento,
      premioFmt: fmtBRL(d.valor * ((insurer?.premioPct ?? 0) / 100)),
      status: d.status,
      sinistroStatus: d.sinistro_status,
    })),
    sinistros: claimable.map((d) => ({
      id: d.id,
      cedente: d.cedente_nome,
      sacado: d.sacado_nome,
      valorFmt: fmtBRL(d.valor),
      vencimento: d.vencimento,
    })),
  };
}

seguradoraRouter.get('/', (req, res) => res.json(payload(req)));

const decisionSchema = z.object({ decision: z.enum(['aprovado', 'negado']), note: z.string().trim().min(1) });

seguradoraRouter.post(
  '/sinistro/:duplicataId/decidir',
  asyncHandler(async (req, res) => {
    const parsed = decisionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    const insurer = insurerDef(req.user!.insurer_key);
    if (!insurer) {
      res.status(409).json({ error: 'no_insurer', message: 'Sua conta não está vinculada a uma seguradora parceira.' });
      return;
    }
    const claimable = listClaimableByInsurerKey(insurer.key);
    const target = claimable.find((d) => d.id === req.params.duplicataId);
    if (!target) {
      res.status(404).json({ error: 'not_found', message: 'Sinistro não encontrado ou já decidido.' });
      return;
    }
    setSinistroStatus(target.id, parsed.data.decision === 'aprovado' ? 'aprovado' : 'negado', parsed.data.note);
    if (target.cedente_id) {
      const verb = parsed.data.decision === 'aprovado' ? 'aprovou o sinistro e indenizará' : 'negou o sinistro de';
      addNotification(
        target.cedente_id,
        `${insurer.name} ${verb} a duplicata ${target.id} (${fmtBRL(target.valor)}): ${parsed.data.note}`,
        parsed.data.decision === 'aprovado' ? COLORS.GREEN : COLORS.RED,
        'disputa'
      );
    }
    recordAuditEvent(req.user!.id, req.user!.company_name, 'sinistro.decidido', { duplicataId: target.id, decision: parsed.data.decision });
    res.json(payload(req));
  })
);
