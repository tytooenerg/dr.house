import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { getSettings, updateSettings } from '../db/users.js';
import { addLedgerEntry, listLedger } from '../db/misc.js';
import { fmtBRL } from '../lib/format.js';
import { getRevenueStreams } from '../lib/revenue.js';

export const accountRouter = Router();
accountRouter.use(requireAuth);

function extratoView(userId: number) {
  const rows = listLedger(userId);
  let saldo = rows.reduce((sum, r) => sum + r.valor, 0);
  const withRunningBalance: { data: string; descricao: string; valorFmt: string; isPositive: boolean; saldoFmt: string }[] = [];
  for (const r of rows) {
    withRunningBalance.push({ data: r.data, descricao: r.descricao, valorFmt: (r.valor >= 0 ? '+' : '') + fmtBRL(r.valor), isPositive: r.valor >= 0, saldoFmt: fmtBRL(saldo) });
    saldo -= r.valor;
  }
  return withRunningBalance;
}

function payload(req: import('express').Request) {
  const settings = getSettings(req.user!);
  return {
    kycChecklist: [
      { label: 'Dados cadastrais da empresa', status: 'Concluído', bg: '#EAF3EE', color: '#0A5C36', action: null },
      {
        label: 'Documentos societários (contrato social)',
        status: settings.kycDocsUploaded ? 'Concluído' : settings.kycDocsRejected ? 'Recusado — foto ilegível' : 'Pendente',
        bg: settings.kycDocsUploaded ? '#EAF3EE' : settings.kycDocsRejected ? '#F7E9E7' : '#F0F2F5',
        color: settings.kycDocsUploaded ? '#0A5C36' : settings.kycDocsRejected ? '#B03A2E' : '#5B6472',
        action: settings.kycDocsUploaded ? null : { label: settings.kycDocsRejected ? 'Reenviar documentos' : 'Enviar documentos', key: 'docs' },
      },
      { label: 'Verificação antifraude (KYC)', status: 'Em análise', bg: '#FBF1E0', color: '#B8790A', action: null },
      {
        label: 'Conta bancária para liquidação',
        status: settings.kycBankConnected ? 'Concluído' : 'Pendente',
        bg: settings.kycBankConnected ? '#EAF3EE' : '#F0F2F5',
        color: settings.kycBankConnected ? '#0A5C36' : '#5B6472',
        action: settings.kycBankConnected ? null : { label: 'Conectar conta', key: 'bank' },
      },
    ],
    bankAccountDisplay: settings.kycBankConnected ? 'Banco Itaú Unibanco · Ag 1234 · CC 00045-6 ✓' : 'Nenhuma conta conectada — conclua o KYC acima',
    settlementSpeed: settings.settlementSpeed,
    extrato: extratoView(req.user!.id),
  };
}

accountRouter.get('/', (req, res) => res.json(payload(req)));

accountRouter.post('/kyc/bank', (req, res) => {
  updateSettings(req.user!.id, { kycBankConnected: true });
  addLedgerEntry(req.user!.id, new Date().toLocaleDateString('pt-BR'), 'Conta bancária conectada para liquidação', 0);
  res.json(payload(req));
});

accountRouter.post('/kyc/docs', (req, res) => {
  const settings = getSettings(req.user!);
  const attempts = settings.kycDocsAttempts + 1;
  if (attempts === 1) {
    updateSettings(req.user!.id, { kycDocsAttempts: attempts, kycDocsRejected: true });
  } else {
    updateSettings(req.user!.id, { kycDocsAttempts: attempts, kycDocsRejected: false, kycDocsUploaded: true });
  }
  res.json(payload(req));
});

const speedSchema = z.object({ speed: z.enum(['d0', 'd1']) });

accountRouter.post('/settlement-speed', (req, res) => {
  const parsed = speedSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
    return;
  }
  updateSettings(req.user!.id, { settlementSpeed: parsed.data.speed });
  res.json(payload(req));
});

export const revenueRouter = Router();
revenueRouter.use(requireAuth);
revenueRouter.get('/', (_req, res) => res.json(getRevenueStreams()));
