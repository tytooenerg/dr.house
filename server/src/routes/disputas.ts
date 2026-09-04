import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import {
  listOpenDisputesByCedente,
  getDispute,
  listEvents,
  setEvidenceStatus,
  addEvent,
  resolveDispute,
  proposeResolution,
  clearProposedResolution,
} from '../db/disputes.js';
import { getAceite, setAceiteStatus } from '../db/aceites.js';
import { getDuplicata } from '../db/duplicatas.js';
import { addNotification } from '../db/misc.js';
import { recordAuditEvent } from '../db/audit.js';
import { fmtBRL, fmtRelative } from '../lib/format.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { COLORS } from '../data/seed.js';

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
    // Uma proposta do cedente nunca resolve a disputa sozinha — só sinaliza que está
    // aguardando o sacado confirmar (ou recusar) do lado dele (ver AceitePage.tsx).
    isProposed: !!d.proposed_resolution,
    proposedResolution: d.proposed_resolution,
    proposedAt: d.proposed_at ? fmtRelative(d.proposed_at) : null,
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

// Achado corrigido: isto costumava chamar resolveDispute()+setAceiteStatus('aceita')
// direto — o próprio cedente encerrando sozinho uma disputa aberta contra ele, sem
// confirmação do sacado nem revisão do admin, já restaurando o aceite e liberando
// cobrança jurídica (lib/legalCollection.ts exige aceite 'aceita'). Isso não é uma
// resolução válida — nem uma transação civil comum dispensa consentimento das duas
// partes (CC art. 840). Agora isto só registra uma PROPOSTA; só vira resolução real
// quando o sacado confirma (POST /:id/confirmar, abaixo) ou o admin arbitra
// (routes/admin.ts's POST /disputes/:id/resolve).
disputaRouter.post('/:id/propor', (req, res) => {
  const id = Number(req.params.id);
  if (!ownsDispute(req, id)) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  const note = typeof req.body?.note === 'string' && req.body.note.trim() ? req.body.note.trim() : 'evidência aceita, aceite restabelecido';
  proposeResolution(id, note, req.user!.id);
  addEvent(id, req.user!.company_name, `Propôs resolução: "${note}" — aguardando confirmação do sacado.`);
  recordAuditEvent(req.user!.id, req.user!.company_name, 'dispute.proposed', { disputeId: id });
  res.json({ disputes: view(req) });
});

// O admin já vê toda disputa aberta via listAllOpenDisputes() independente disso — não
// existe uma fila separada de "escalada" pra entrar. Isto só registra, de forma
// explícita e auditável, que o cedente não quer esperar o sacado confirmar uma
// autocomposição e prefere que o Banco Central arbitre direto (o botão "Escalar para
// arbitragem BC" da tela não fazia nada antes desta correção).
disputaRouter.post('/:id/escalar', (req, res) => {
  const id = Number(req.params.id);
  if (!ownsDispute(req, id)) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  addEvent(id, req.user!.company_name, 'Solicitou arbitragem direta do Banco Central, sem propor autocomposição.');
  recordAuditEvent(req.user!.id, req.user!.company_name, 'dispute.escalated', { disputeId: id });
  res.json({ disputes: view(req) });
});

function findDisputeForSacado(req: import('express').Request, disputeId: number) {
  if (req.user!.role !== 'sacado') return null;
  const dispute = getDispute(disputeId);
  if (!dispute) return null;
  const aceite = getAceite(dispute.aceite_id);
  if (!aceite) return null;
  const duplicata = getDuplicata(aceite.duplicata_id);
  if (!duplicata || duplicata.sacado_nome.toLowerCase() !== req.user!.company_name.toLowerCase()) return null;
  return { dispute, aceite, duplicata };
}

// O sacado confirma a proposta do cedente — só agora a disputa é resolvida de verdade
// (aceite volta pra 'aceita') e sai da fila do admin, com consentimento real das duas
// partes, não só a palavra do credor interessado.
disputaRouter.post('/:id/confirmar', (req, res) => {
  const id = Number(req.params.id);
  const found = findDisputeForSacado(req, id);
  if (!found || !found.dispute.proposed_resolution) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  resolveDispute(id, `sacado confirmou: ${found.dispute.proposed_resolution}`, req.user!.id);
  setAceiteStatus(found.aceite.id, 'aceita');
  addEvent(id, req.user!.company_name, 'Confirmou a proposta do cedente — disputa resolvida.');
  if (found.duplicata.cedente_id) {
    addNotification(found.duplicata.cedente_id, `${req.user!.company_name} confirmou a resolução da disputa em ${found.duplicata.id}.`, COLORS.GREEN, 'disputa');
  }
  recordAuditEvent(req.user!.id, req.user!.company_name, 'dispute.confirmed_by_sacado', { disputeId: id });
  res.json({ ok: true });
});

// O sacado recusa a proposta: a disputa continua aberta pro admin arbitrar, nada muda no
// aceite. O cedente pode propor de novo depois se conseguir mais evidência.
disputaRouter.post('/:id/recusar', (req, res) => {
  const id = Number(req.params.id);
  const found = findDisputeForSacado(req, id);
  if (!found || !found.dispute.proposed_resolution) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  clearProposedResolution(id);
  addEvent(id, req.user!.company_name, 'Recusou a proposta do cedente — disputa segue em aberto para arbitragem.');
  if (found.duplicata.cedente_id) {
    addNotification(found.duplicata.cedente_id, `${req.user!.company_name} recusou a proposta de resolução em ${found.duplicata.id}.`, COLORS.RED, 'disputa');
  }
  recordAuditEvent(req.user!.id, req.user!.company_name, 'dispute.proposal_rejected', { disputeId: id });
  res.json({ ok: true });
});
