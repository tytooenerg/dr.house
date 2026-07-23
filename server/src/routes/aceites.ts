import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { listAceitesByCedente, listAceitesBySacadoNome, getAceite, setAceiteStatus } from '../db/aceites.js';
import { getDuplicata } from '../db/duplicatas.js';
import { addNotification } from '../db/misc.js';
import { createDispute, getDisputeByAceite } from '../db/disputes.js';
import { recordAuditEvent } from '../db/audit.js';
import { fmtBRL } from '../lib/format.js';
import { COLORS } from '../data/seed.js';
import { asyncHandler } from '../lib/asyncHandler.js';

export const aceiteRouter = Router();
aceiteRouter.use(requireAuth);

const STATUS_META = {
  aguardando: { label: 'Aguardando manifestação', bg: '#FBF1E0', color: COLORS.AMBER },
  aceita: { label: 'Aceita pelo sacado', bg: '#EAF3EE', color: COLORS.GREEN },
  contestada: { label: 'Contestada', bg: '#F7E9E7', color: COLORS.RED },
};

function view(
  a: { id: number; duplicata_id: string; status: keyof typeof STATUS_META; prazo_label: string; valor: number; sacado_nome?: string; cedente_nome?: string },
  editable: boolean
) {
  const meta = STATUS_META[a.status];
  return {
    id: a.id,
    duplicataId: a.duplicata_id,
    valorFmt: fmtBRL(a.valor),
    prazo: a.prazo_label,
    status: a.status,
    statusLabel: meta.label,
    statusBg: meta.bg,
    statusColor: meta.color,
    isPending: a.status === 'aguardando',
    editable,
    sacado: a.sacado_nome,
    cedente: a.cedente_nome,
  };
}

function listForUser(req: import('express').Request) {
  if (req.user!.role === 'cedente') {
    return listAceitesByCedente(req.user!.id).map((a) => view(a, false));
  }
  if (req.user!.role === 'sacado') {
    return listAceitesBySacadoNome(req.user!.company_name).map((a) => view(a, true));
  }
  return [];
}

aceiteRouter.get('/', (req, res) => {
  res.json({ aceites: listForUser(req) });
});

const statusSchema = z.object({ status: z.enum(['aceita', 'contestada']) });

aceiteRouter.post(
  '/:id/status',
  asyncHandler(async (req, res) => {
    if (req.user!.role !== 'sacado') {
      res.status(403).json({ error: 'forbidden', message: 'Somente o sacado pode confirmar ou contestar uma duplicata.' });
      return;
    }
    const parsed = statusSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    const aceite = getAceite(Number(req.params.id));
    if (!aceite) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const duplicata = getDuplicata(aceite.duplicata_id);
    if (!duplicata || duplicata.sacado_nome.toLowerCase() !== req.user!.company_name.toLowerCase()) {
      res.status(403).json({ error: 'forbidden', message: 'Esta duplicata não pertence à sua empresa.' });
      return;
    }
    await new Promise((r) => setTimeout(r, 700));
    setAceiteStatus(aceite.id, parsed.data.status);
    if (parsed.data.status === 'contestada' && !getDisputeByAceite(aceite.id)) {
      createDispute(aceite.id, 'Sacado contestou os dados da duplicata — divergência a esclarecer com o cedente.', {
        autor: duplicata.sacado_nome,
        texto: 'Contestou a duplicata.',
      });
    }
    if (duplicata.cedente_id) {
      const verb = parsed.data.status === 'aceita' ? 'aceitou' : 'contestou';
      addNotification(
        duplicata.cedente_id,
        `${duplicata.sacado_nome} ${verb} a duplicata ${duplicata.id} (${fmtBRL(duplicata.valor)})`,
        parsed.data.status === 'aceita' ? COLORS.GREEN : COLORS.RED,
        'aceite'
      );
    }
    recordAuditEvent(req.user!.id, req.user!.company_name, `aceite.${parsed.data.status}`, { duplicataId: duplicata.id });
    res.json({ aceites: listForUser(req) });
  })
);
