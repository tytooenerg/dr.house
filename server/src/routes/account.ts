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
import { boletoEnabled, emitirBoleto } from '../lib/boletoRail.js';
import { createBoleto, getBoleto, concludeBoleto, listBoletosByUser } from '../db/boletos.js';
import { tedEnabled, lastroStaticAccountConfigured, emitirInstrucaoTed, enviarTed } from '../lib/tedRail.js';
import { createTedDeposit, listTedDepositsByUser, recordTedPayout } from '../db/ted.js';
import { stablecoinEnabled, lastroStaticWalletConfigured, stablecoinAsset, stablecoinNetwork, emitirInstrucaoStablecoin, enviarStablecoin } from '../lib/stablecoinRail.js';
import { createStablecoinDeposit, listStablecoinDepositsByUser, recordStablecoinPayout } from '../db/stablecoin.js';
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
      {
        label: 'Verificação antifraude (prova de vida)',
        status: settings.biometricVerified ? 'Verificado ✓' : 'Pendente',
        bg: settings.biometricVerified ? '#EAF3EE' : '#F0F2F5',
        color: settings.biometricVerified ? '#0A5C36' : '#5B6472',
        action: settings.biometricVerified ? null : { label: 'Enviar selfie', key: 'biometria' },
      },
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
    boletoEnabled,
    boletos: listBoletosByUser(req.user!.id)
      .slice(0, 10)
      .map((b) => ({
        nossoNumero: b.nosso_numero,
        valorFmt: fmtBRL(b.valor),
        status: b.status,
        simulado: !!b.simulado,
        linhaDigitavel: b.linha_digitavel,
        pdfUrl: b.pdf_url,
      })),
    tedEnabled,
    tedInstructionsAvailable: tedEnabled || lastroStaticAccountConfigured,
    tedContaBancaria: settings.tedContaBancaria,
    tedDeposits: listTedDepositsByUser(req.user!.id)
      .slice(0, 10)
      .map((t) => ({
        referencia: t.referencia,
        valorFmt: fmtBRL(t.valor),
        status: t.status,
        simulado: !!t.simulado,
        banco: t.banco,
        agencia: t.agencia,
        conta: t.conta,
        favorecidoNome: t.favorecido_nome,
      })),
    stablecoinEnabled,
    stablecoinInstructionsAvailable: stablecoinEnabled || lastroStaticWalletConfigured,
    stablecoinAsset,
    stablecoinNetwork,
    stablecoinWalletEndereco: settings.stablecoinWalletEndereco,
    stablecoinDeposits: listStablecoinDepositsByUser(req.user!.id)
      .slice(0, 10)
      .map((s) => ({
        referencia: s.referencia,
        valorFmt: fmtBRL(s.valor),
        status: s.status,
        simulado: !!s.simulado,
        asset: s.asset,
        network: s.network,
        endereco: s.endereco,
      })),
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
  req.user!.settings = JSON.stringify(updateSettings(req.user!.id, { pixChave: parsed.data.chave, kycBankConnected: true }));
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

// Real boleto rail (lib/boletoRail.ts) — an alternative to Pix, since boleto is still a
// widely used instrument in Brazilian antecipação de recebíveis. Same crediting rule as
// Pix: the ledger is only credited when payment is actually confirmed (webhook, or the
// simulated button below when no PSP is configured), never optimistically at emission.
const depositBoletoSchema = z.object({ valor: z.number().positive().max(10_000_000) });

accountRouter.post(
  '/deposit/boleto',
  asyncHandler(async (req, res) => {
    const parsed = depositBoletoSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    const nossoNumero = randomUUID().replace(/-/g, '').slice(0, 20);
    let cnpj: string | undefined;
    try {
      cnpj = JSON.parse(req.user!.kyb_form || '{}').cnpj;
    } catch {
      cnpj = undefined;
    }
    const vencimento = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    const boleto = await emitirBoleto({
      nossoNumero,
      valor: parsed.data.valor,
      vencimento,
      pagadorNome: req.user!.company_name,
      pagadorCnpj: cnpj,
      descricao: `Depósito Lastro — ${req.user!.company_name}`,
    });
    createBoleto({
      nossoNumero: boleto.nossoNumero,
      userId: req.user!.id,
      valor: parsed.data.valor,
      simulado: boleto.simulado,
      linhaDigitavel: boleto.linhaDigitavel,
      codigoBarras: boleto.codigoBarras,
      pdfUrl: boleto.pdfUrl,
    });
    res.json({ nossoNumero: boleto.nossoNumero, simulado: boleto.simulado, linhaDigitavel: boleto.linhaDigitavel, pdfUrl: boleto.pdfUrl, ...payload(req) });
  })
);

// Demo/dev-only: simulates the banking partner's webhook confirming payment, since
// there's no real PSP to actually pay the boleto against when BOLETO_PSP_* isn't
// configured. Refuses to run once a real PSP is configured.
accountRouter.post('/deposit/boleto/:nossoNumero/confirm-simulado', (req, res) => {
  if (boletoEnabled) {
    res.status(409).json({ error: 'boleto_real_configured', message: 'PSP de boleto real configurado — aguarde a confirmação de pagamento; não há confirmação simulada.' });
    return;
  }
  const boleto = getBoleto(req.params.nossoNumero);
  if (!boleto || boleto.user_id !== req.user!.id) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  if (boleto.status !== 'ativo') {
    res.status(409).json({ error: 'already_settled' });
    return;
  }
  concludeBoleto(boleto.nosso_numero);
  addLedgerEntry(req.user!.id, new Date().toLocaleDateString('pt-BR'), `Depósito via boleto confirmado (simulado) — ${fmtBRL(boleto.valor)}`, boleto.valor);
  res.json(payload(req));
});

// Real TED rail (lib/tedRail.ts) — a third deposit method for large institutional
// transfers. Unlike Pix/boleto, there's deliberately no self-service confirm-simulado
// endpoint here: a deposited TED is only ever confirmed by a real BaaS webhook
// (POST /public/ted-webhook, when TED_PSP_* is configured) or by an admin matching the
// real bank statement (POST /admin/ted/:referencia/confirmar) — see lib/tedRail.ts for why.
const depositTedSchema = z.object({ valor: z.number().positive().max(10_000_000) });

accountRouter.post(
  '/deposit/ted',
  asyncHandler(async (req, res) => {
    const parsed = depositTedSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    const referencia = `TED${randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase()}`;
    const instrucao = await emitirInstrucaoTed({ referencia, valor: parsed.data.valor, pagadorNome: req.user!.company_name });
    createTedDeposit({
      referencia: instrucao.referencia,
      userId: req.user!.id,
      valor: parsed.data.valor,
      simulado: instrucao.simulado,
      banco: instrucao.banco,
      agencia: instrucao.agencia,
      conta: instrucao.conta,
      favorecidoNome: instrucao.favorecidoNome,
      favorecidoCnpj: instrucao.favorecidoCnpj,
    });
    res.json({ instrucao, ...payload(req) });
  })
);

const tedContaSchema = z.object({
  banco: z.string().trim().min(1).max(80),
  agencia: z.string().trim().min(1).max(20),
  conta: z.string().trim().min(1).max(30),
  tipoConta: z.enum(['corrente', 'poupanca']),
  titularNome: z.string().trim().min(1).max(140),
  titularCnpj: z.string().trim().min(11).max(20),
});

accountRouter.post('/kyc/bank-ted', (req, res) => {
  const parsed = tedContaSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
    return;
  }
  req.user!.settings = JSON.stringify(updateSettings(req.user!.id, { tedContaBancaria: parsed.data }));
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

accountRouter.post(
  '/withdraw/ted',
  asyncHandler(async (req, res) => {
    const parsed = withdrawSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    const settings = getSettings(req.user!);
    if (!settings.tedContaBancaria) {
      res.status(409).json({ error: 'no_ted_account', message: 'Cadastre uma conta bancária para TED antes de sacar.' });
      return;
    }
    const disponivel = saldoDisponivel(req.user!.id);
    if (parsed.data.valor > disponivel) {
      res.status(409).json({ error: 'insufficient_balance', message: `Saldo disponível: ${fmtBRL(disponivel)}` });
      return;
    }
    const conta = settings.tedContaBancaria;
    const payout = await enviarTed({
      banco: conta.banco,
      agencia: conta.agencia,
      conta: conta.conta,
      tipoConta: conta.tipoConta,
      favorecidoNome: conta.titularNome,
      favorecidoCnpj: conta.titularCnpj,
      valor: parsed.data.valor,
      descricao: `Saque Lastro — ${req.user!.company_name}`,
    });
    recordTedPayout({
      userId: req.user!.id,
      valor: parsed.data.valor,
      banco: conta.banco,
      agencia: conta.agencia,
      conta: conta.conta,
      favorecidoNome: conta.titularNome,
      favorecidoCnpj: conta.titularCnpj,
      simulado: payout.simulado,
      protocolo: payout.protocolo,
    });
    addLedgerEntry(
      req.user!.id,
      new Date().toLocaleDateString('pt-BR'),
      `Saque via TED para ${conta.banco} ag. ${conta.agencia}${payout.simulado ? ' (simulado)' : ''}`,
      -parsed.data.valor
    );
    res.json(payload(req));
  })
);

// Real stablecoin rail (lib/stablecoinRail.ts) — a fourth deposit/withdraw method,
// modeled on TED rather than Pix/boleto: no self-service "confirm (simulado)" flow, since
// a user self-attesting an on-chain transfer landed can't be trusted any more than a user
// self-attesting a TED did. Reconciliation is either a real custodial/VASP webhook
// (POST /public/stablecoin-webhook) or an admin matching the chain explorer by hand
// (POST /admin/stablecoin/:referencia/confirmar).
const depositStablecoinSchema = z.object({ valor: z.number().positive().max(10_000_000) });

accountRouter.post(
  '/deposit/stablecoin',
  asyncHandler(async (req, res) => {
    const parsed = depositStablecoinSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    const referencia = `SC${randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase()}`;
    const instrucao = await emitirInstrucaoStablecoin({ referencia, valor: parsed.data.valor });
    createStablecoinDeposit({
      referencia: instrucao.referencia,
      userId: req.user!.id,
      valor: parsed.data.valor,
      simulado: instrucao.simulado,
      asset: instrucao.asset,
      network: instrucao.network,
      endereco: instrucao.endereco,
    });
    res.json({ instrucao, ...payload(req) });
  })
);

const stablecoinWalletSchema = z.object({ endereco: z.string().trim().min(10).max(120) });

accountRouter.post('/kyc/wallet-stablecoin', (req, res) => {
  const parsed = stablecoinWalletSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
    return;
  }
  req.user!.settings = JSON.stringify(updateSettings(req.user!.id, { stablecoinWalletEndereco: parsed.data.endereco }));
  res.json(payload(req));
});

accountRouter.post(
  '/withdraw/stablecoin',
  asyncHandler(async (req, res) => {
    const parsed = withdrawSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    const settings = getSettings(req.user!);
    if (!settings.stablecoinWalletEndereco) {
      res.status(409).json({ error: 'no_stablecoin_wallet', message: 'Cadastre um endereço de carteira antes de sacar.' });
      return;
    }
    const disponivel = saldoDisponivel(req.user!.id);
    if (parsed.data.valor > disponivel) {
      res.status(409).json({ error: 'insufficient_balance', message: `Saldo disponível: ${fmtBRL(disponivel)}` });
      return;
    }
    const payout = await enviarStablecoin({
      enderecoDestino: settings.stablecoinWalletEndereco,
      valor: parsed.data.valor,
      descricao: `Saque Lastro — ${req.user!.company_name}`,
    });
    recordStablecoinPayout({
      userId: req.user!.id,
      valor: parsed.data.valor,
      asset: stablecoinAsset,
      network: stablecoinNetwork,
      endereco: settings.stablecoinWalletEndereco,
      simulado: payout.simulado,
      txHash: payout.txHash,
    });
    addLedgerEntry(
      req.user!.id,
      new Date().toLocaleDateString('pt-BR'),
      `Saque via ${stablecoinAsset} para ${settings.stablecoinWalletEndereco}${payout.simulado ? ' (simulado)' : ''}`,
      -parsed.data.valor
    );
    res.json(payload(req));
  })
);

accountRouter.post('/kyc/docs', (req, res) => {
  const settings = getSettings(req.user!);
  const attempts = settings.kycDocsAttempts + 1;
  const merged =
    attempts === 1
      ? updateSettings(req.user!.id, { kycDocsAttempts: attempts, kycDocsRejected: true })
      : updateSettings(req.user!.id, { kycDocsAttempts: attempts, kycDocsRejected: false, kycDocsUploaded: true });
  req.user!.settings = JSON.stringify(merged);
  res.json(payload(req));
});

const speedSchema = z.object({ speed: z.enum(['d0', 'd1']) });

accountRouter.post('/settlement-speed', (req, res) => {
  const parsed = speedSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
    return;
  }
  req.user!.settings = JSON.stringify(updateSettings(req.user!.id, { settlementSpeed: parsed.data.speed }));
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
