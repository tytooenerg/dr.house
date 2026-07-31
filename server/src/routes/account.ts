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
import { pixEnabled, criarCobranca, enviarPix } from '../lib/paymentRail.js';
import { createPixCharge, getPixCharge, concludePixCharge, listPixChargesByUser, recordPixPayout } from '../db/pix.js';
import { randomUUID } from 'node:crypto';

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

function saldoDisponivel(userId: number): number {
  return listLedger(userId).reduce((sum, r) => sum + r.valor, 0);
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
        label: 'Chave Pix para liquidação',
        status: settings.pixChave ? 'Concluído' : 'Pendente',
        bg: settings.pixChave ? '#EAF3EE' : '#F0F2F5',
        color: settings.pixChave ? '#0A5C36' : '#5B6472',
        action: settings.pixChave ? null : { label: 'Cadastrar chave Pix', key: 'bank' },
      },
    ],
    pixEnabled,
    pixChave: settings.pixChave,
    bankAccountDisplay: settings.pixChave
      ? `Chave Pix cadastrada: ${settings.pixChave} ${pixEnabled ? '· PSP real conectado' : '· modo simulado (configure PIX_PSP_* para operar com dinheiro real)'}`
      : 'Nenhuma chave Pix cadastrada — cadastre uma acima para depositar e sacar',
    saldoDisponivelFmt: fmtBRL(saldoDisponivel(req.user!.id)),
    pixCharges: listPixChargesByUser(req.user!.id)
      .slice(0, 10)
      .map((c) => ({ txid: c.txid, valorFmt: fmtBRL(c.valor), status: c.status, simulado: !!c.simulado, brcode: c.brcode })),
    settlementSpeed: settings.settlementSpeed,
    extrato: extratoView(req.user!.id),
  };
}

accountRouter.get('/', (req, res) => res.json(payload(req)));

const pixKeySchema = z.object({ chave: z.string().trim().min(3).max(140) });

accountRouter.post('/kyc/bank', (req, res) => {
  const parsed = pixKeySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
    return;
  }
  updateSettings(req.user!.id, { pixChave: parsed.data.chave, kycBankConnected: true });
  addLedgerEntry(req.user!.id, new Date().toLocaleDateString('pt-BR'), 'Chave Pix cadastrada para liquidação', 0);
  res.json(payload(req));
});

const depositSchema = z.object({ valor: z.number().positive().max(10_000_000) });

// Creates a real Pix cobrança (or a clearly-labeled simulated one — see lib/paymentRail.ts)
// for the investor/cedente to fund their platform balance. Crediting the ledger happens
// only when the PSP confirms payment via the webhook below (or, in simulated mode, via
// the confirm-simulado endpoint) — never optimistically at creation time.
accountRouter.post(
  '/deposit',
  asyncHandler(async (req, res) => {
    const parsed = depositSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    const txid = randomUUID().replace(/-/g, '').slice(0, 32);
    let cnpj: string | undefined;
    try {
      cnpj = JSON.parse(req.user!.kyb_form || '{}').cnpj;
    } catch {
      cnpj = undefined;
    }
    const cobranca = await criarCobranca({
      txid,
      valor: parsed.data.valor,
      devedorNome: req.user!.company_name,
      devedorCnpj: cnpj,
      descricao: `Depósito Lastro — ${req.user!.company_name}`,
    });
    createPixCharge({ txid: cobranca.txid, userId: req.user!.id, valor: parsed.data.valor, simulado: cobranca.simulado, brcode: cobranca.brcode });
    res.json({ txid: cobranca.txid, simulado: cobranca.simulado, brcode: cobranca.brcode, ...payload(req) });
  })
);

// Demo/dev-only: simulates the PSP webhook confirming payment, since there's no real PSP
// to actually pay the cobrança against when PIX_PSP_* isn't configured. Refuses to run
// once a real PSP is configured — real deposits are only ever confirmed by the webhook.
accountRouter.post('/deposit/:txid/confirm-simulado', (req, res) => {
  if (pixEnabled) {
    res.status(409).json({ error: 'pix_real_configured', message: 'PSP real configurado — confirme pagando o QR code; não há confirmação simulada.' });
    return;
  }
  const charge = getPixCharge(req.params.txid);
  if (!charge || charge.user_id !== req.user!.id) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  if (charge.status !== 'ativa') {
    res.status(409).json({ error: 'already_settled' });
    return;
  }
  concludePixCharge(charge.txid, null);
  addLedgerEntry(req.user!.id, new Date().toLocaleDateString('pt-BR'), `Depósito via Pix confirmado (simulado) — ${fmtBRL(charge.valor)}`, charge.valor);
  res.json(payload(req));
});

const withdrawSchema = z.object({ valor: z.number().positive().max(10_000_000) });

accountRouter.post(
  '/withdraw',
  asyncHandler(async (req, res) => {
    const parsed = withdrawSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    const settings = getSettings(req.user!);
    if (!settings.pixChave) {
      res.status(409).json({ error: 'no_pix_key', message: 'Cadastre uma chave Pix antes de sacar.' });
      return;
    }
    const disponivel = saldoDisponivel(req.user!.id);
    if (parsed.data.valor > disponivel) {
      res.status(409).json({ error: 'insufficient_balance', message: `Saldo disponível: ${fmtBRL(disponivel)}` });
      return;
    }
    const payout = await enviarPix({ chaveDestino: settings.pixChave, valor: parsed.data.valor, descricao: `Saque Lastro — ${req.user!.company_name}` });
    recordPixPayout({ userId: req.user!.id, valor: parsed.data.valor, chaveDestino: settings.pixChave, simulado: payout.simulado, endToEndId: payout.endToEndId });
    addLedgerEntry(
      req.user!.id,
      new Date().toLocaleDateString('pt-BR'),
      `Saque via Pix para ${settings.pixChave}${payout.simulado ? ' (simulado)' : ''}`,
      -parsed.data.valor
    );
    res.json(payload(req));
  })
);

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
