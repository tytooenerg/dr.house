import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { anonymizeUser, getSettings, updateSettings } from '../db/users.js';
import { addLedgerEntry, listLedger, listNotifications } from '../db/misc.js';
import { listApiKeys, revokeAllApiKeysForUser } from '../db/apiKeys.js';
import { deleteAllWebhooksForUser, listWebhooks } from '../db/webhooks.js';
import { revokeAllRefreshTokensForUser } from '../db/refreshTokens.js';
import { listByCedente, listBySacadoNome } from '../db/duplicatas.js';
import { listAceitesByCedente, listAceitesBySacadoNome } from '../db/aceites.js';
import { recordAuditEvent } from '../db/audit.js';
import { verifyPassword } from '../auth/password.js';
import { fmtBRL } from '../lib/format.js';
import { getRevenueStreams } from '../lib/revenue.js';
import { asyncHandler } from '../lib/asyncHandler.js';

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

// LGPD: right to data portability. A single JSON dump of everything tied to the
// account — personal data, financial records the account is a party to, and API/webhook
// configuration (never raw secrets, only their metadata).
accountRouter.get('/export', (req, res) => {
  const user = req.user!;
  res.json({
    exportedAt: new Date().toISOString(),
    perfil: {
      id: user.id,
      email: user.email,
      nome: user.nome,
      telefone: user.telefone,
      companyName: user.company_name,
      role: user.role,
      plan: user.plan,
      createdAt: user.created_at,
    },
    settings: getSettings(user),
    duplicatasComoCedente: user.role === 'cedente' ? listByCedente(user.id) : [],
    duplicatasComoSacado: user.role === 'sacado' ? listBySacadoNome(user.company_name) : [],
    aceites: user.role === 'cedente' ? listAceitesByCedente(user.id) : user.role === 'sacado' ? listAceitesBySacadoNome(user.company_name) : [],
    notificacoes: listNotifications(user.id, 1000),
    extratoFinanceiro: listLedger(user.id),
    chavesDeApi: listApiKeys(user.id).map((k) => ({
      id: k.id,
      prefixo: k.key_prefix,
      modo: k.mode,
      escopo: k.scope,
      revogada: !!k.revoked,
      criadaEm: k.created_at,
    })),
    webhooks: listWebhooks(user.id).map((w) => ({ id: w.id, url: w.url, evento: w.event, ativo: !!w.active })),
  });
});

const deleteAccountSchema = z.object({ password: z.string().min(1, 'Informe sua senha para confirmar.') });

// LGPD: right to erasure. Scrubs personal identifiers and revokes every active
// credential (sessions, API keys, webhooks), but keeps the account row and its financial
// records intact (anonymized) since deleting them outright would corrupt other parties'
// duplicatas/audit trail — this mirrors how real regulated platforms handle Art. 16.
accountRouter.post(
  '/delete',
  asyncHandler(async (req, res) => {
    const parsed = deleteAccountSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    const ok = await verifyPassword(parsed.data.password, req.user!.password_hash);
    if (!ok) {
      res.status(401).json({ error: 'invalid_password', message: 'Senha incorreta.' });
      return;
    }
    recordAuditEvent(req.user!.id, req.user!.company_name, 'conta.excluida', {});
    revokeAllRefreshTokensForUser(req.user!.id);
    revokeAllApiKeysForUser(req.user!.id);
    deleteAllWebhooksForUser(req.user!.id);
    anonymizeUser(req.user!.id);
    res.json({ ok: true });
  })
);

export const revenueRouter = Router();
revenueRouter.use(requireAuth);
revenueRouter.get('/', (_req, res) => res.json(getRevenueStreams()));
