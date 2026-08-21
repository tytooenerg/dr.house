import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { listOpenDisputesByCedente, getDispute, listEvents, setEvidenceStatus, addEvent, resolveDispute } from '../db/disputes.js';
import { getAceite, setAceiteStatus } from '../db/aceites.js';
import { recordAuditEvent } from '../db/audit.js';
import { fmtBRL, fmtRelative } from '../lib/format.js';
import { asyncHandler } from '../lib/asyncHandler.js';

export const disputaRouter = Router();
disputaRouter.use(requireAuth);

function view(req: import('express').Request) {
  return listOpenDisputesByCedente(req.user!.id).map((d) => ({
    id: d.id,
    duplicataId: d.duplicata_id,
    sacado: d.sacado_nome,
    valorFmt: fmtBRL(d.valor),
    motivo: d.motivo,
    timeline: listEvents(d.id).map((e) => ({ autor: e.autor, texto: e.texto, quando: fmtRelative(e.created_at) })),
    isSending: d.evidence_status === 'enviando',
    isSent: d.evidence_status === 'enviada',
    canSend: !d.evidence_status,
  }));
}

disputaRouter.get('/', (req, res) => {
  if (req.user!.role !== 'cedente') {
    res.json({ disputes: [] });
    return;
  }
  res.json({ disputes: view(req) });
});

function ownsDispute(req: import('express').Request, disputeId: number) {
  return listOpenDisputesByCedente(req.user!.id).some((d) => d.id === disputeId);
}

disputaRouter.post(
  '/:id/evidence',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!ownsDispute(req, id)) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    setEvidenceStatus(id, 'enviando');
    await new Promise((r) => setTimeout(r, 700));
    setEvidenceStatus(id, 'enviada');
    addEvent(id, req.user!.company_name, 'Enviou evidência (NF-e / comprovante) para análise.');
    res.json({ disputes: view(req) });
  })
);

disputaRouter.post('/:id/resolve', (req, res) => {
  const id = Number(req.params.id);
  if (!ownsDispute(req, id)) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  const dispute = getDispute(id)!;
  resolveDispute(id, 'cedente: evidência aceita, aceite restabelecido', req.user!.id);
  const aceite = getAceite(dispute.aceite_id);
  if (aceite) setAceiteStatus(aceite.id, 'aceita');
  recordAuditEvent(req.user!.id, req.user!.company_name, 'dispute.resolved_by_cedente', { disputeId: id });
  res.json({ disputes: view(req) });
});
