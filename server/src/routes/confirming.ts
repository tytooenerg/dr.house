import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { recordAuditEvent } from '../db/audit.js';
import {
  criarPrograma,
  desmatricular,
  getCompanyCnpj,
  getMeuPrograma,
  listarCedentesElegiveis,
  listMinhasMatriculas,
  matricular,
  pausarPrograma,
  reativarPrograma,
} from '../lib/confirmingCore.js';

export const confirmingRouter = Router();
confirmingRouter.use(requireAuth);

// --- Sacado: criar e gerenciar o próprio programa ---

confirmingRouter.get('/meu-programa', requireRole('sacado'), (req, res) => {
  res.json({ programa: getMeuPrograma(req.user!), cnpjAtual: getCompanyCnpj(req.user!) });
});

const criarSchema = z.object({ cnpj: z.string().trim().min(1).max(20), limite: z.string().trim().min(1) });

confirmingRouter.post('/criar', requireRole('sacado'), (req, res) => {
  const parsed = criarSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
    return;
  }
  const outcome = criarPrograma(req.user!, parsed.data.cnpj, parsed.data.limite);
  if (outcome.status === 200) {
    recordAuditEvent(req.user!.id, req.user!.company_name, 'confirming.programa_criado', { programaId: outcome.body.id, limiteFmt: outcome.body.limiteFmt });
  }
  res.status(outcome.status).json(outcome.body);
});

confirmingRouter.post('/pausar', requireRole('sacado'), (req, res) => {
  const outcome = pausarPrograma(req.user!);
  if (outcome.status === 200) recordAuditEvent(req.user!.id, req.user!.company_name, 'confirming.programa_pausado', { programaId: outcome.body.id });
  res.status(outcome.status).json(outcome.body);
});

confirmingRouter.post('/reativar', requireRole('sacado'), (req, res) => {
  const outcome = reativarPrograma(req.user!);
  if (outcome.status === 200) recordAuditEvent(req.user!.id, req.user!.company_name, 'confirming.programa_reativado', { programaId: outcome.body.id });
  res.status(outcome.status).json(outcome.body);
});

confirmingRouter.get('/elegiveis', requireRole('sacado'), (req, res) => {
  res.json({ elegiveis: listarCedentesElegiveis(req.user!) });
});

const matricularSchema = z.object({ cedenteUserId: z.number().int().positive(), sublimite: z.string().trim().min(1).nullable().optional() });

confirmingRouter.post('/membros', requireRole('sacado'), (req, res) => {
  const parsed = matricularSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
    return;
  }
  const outcome = matricular(req.user!, parsed.data.cedenteUserId, parsed.data.sublimite ?? null);
  if (outcome.status === 200) {
    recordAuditEvent(req.user!.id, req.user!.company_name, 'confirming.cedente_matriculado', { cedenteUserId: parsed.data.cedenteUserId });
  }
  res.status(outcome.status).json(outcome.body);
});

confirmingRouter.post('/membros/:id/remover', requireRole('sacado'), (req, res) => {
  const outcome = desmatricular(req.user!, Number(req.params.id));
  if (outcome.status === 200) recordAuditEvent(req.user!.id, req.user!.company_name, 'confirming.cedente_desmatriculado', { membroId: Number(req.params.id) });
  res.status(outcome.status).json(outcome.body);
});

// --- Cedente: ver em quais programas está matriculado ---

confirmingRouter.get('/minhas-matriculas', requireRole('cedente'), (req, res) => {
  res.json({ matriculas: listMinhasMatriculas(req.user!) });
});
