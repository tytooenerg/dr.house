import { logger } from './logger.js';

// Real TED (Transferência Eletrônica Disponível) rail — a same-day bank wire, still the
// preferred instrument for large institutional transfers in Brazil (many banks cap Pix
// well below what TED allows, especially for a first-time payee). Unlike Pix's
// BACEN-standardized "API Pix" or the fairly standard boleto registration APIs, TED
// reconciliation has no single universal real-time confirmation contract: a deposited
// TED only shows up on Lastro's bank statement, matched by reference — same as at any
// real fintech without a banking-as-a-service (BaaS) virtual-account product (Dock,
// Celcoin, QI Tech…) in front of it. TED_PSP_* plugs in exactly that kind of BaaS
// provider, which can issue its own dedicated reference/webhook; without it, deposit
// instructions fall back to Lastro's own static receiving account (LASTRO_TED_*) with a
// reference code an admin matches by hand against the real statement. Deliberately no
// user-facing "confirmar (simulado)" button the way Pix/boleto have — a user
// self-attesting a TED landed would misrepresent how TED reconciliation actually works;
// only an admin (who can actually see the bank statement) confirms one.

const baseUrl = process.env.TED_PSP_BASE_URL;
const clientId = process.env.TED_PSP_CLIENT_ID;
const clientSecret = process.env.TED_PSP_CLIENT_SECRET;

export const tedEnabled = !!(baseUrl && clientId && clientSecret);

const lastroBanco = process.env.LASTRO_TED_BANCO;
const lastroAgencia = process.env.LASTRO_TED_AGENCIA;
const lastroConta = process.env.LASTRO_TED_CONTA;
const lastroCnpj = process.env.LASTRO_TED_CNPJ;
export const lastroStaticAccountConfigured = !!(lastroBanco && lastroAgencia && lastroConta && lastroCnpj);

if (tedEnabled) {
  logger.info('[ted] BaaS configurado (TED_PSP_*) — conta virtual dedicada e confirmação via webhook habilitadas');
} else if (lastroStaticAccountConfigured) {
  logger.info('[ted] LASTRO_TED_* configurado — depósitos via TED usam a conta bancária real da Lastro, confirmação manual pelo time');
} else {
  logger.info('[ted] TED_PSP_*/LASTRO_TED_* não configurados — dados bancários de depósito serão simulados');
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token;
  const res = await fetch(`${baseUrl}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
    },
    body: 'grant_type=client_credentials&scope=ted.write ted.read',
  });
  if (!res.ok) throw new Error(`ted_oauth_failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: data.access_token, expiresAt: Date.now() + Math.max(1, data.expires_in - 30) * 1000 };
  return cachedToken.token;
}

export interface TedDepositInstruction {
  referencia: string;
  simulado: boolean;
  banco: string;
  agencia: string;
  conta: string;
  favorecidoNome: string;
  favorecidoCnpj: string;
}

export async function emitirInstrucaoTed(opts: { referencia: string; valor: number; pagadorNome: string }): Promise<TedDepositInstruction> {
  if (tedEnabled) {
    const token = await getAccessToken();
    const res = await fetch(`${baseUrl}/ted/contas-virtuais`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ referencia: opts.referencia, valorEsperado: opts.valor.toFixed(2), pagador: opts.pagadorNome }),
    });
    if (!res.ok) throw new Error(`ted_instrucao_failed: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as {
      referencia?: string;
      banco: string;
      agencia: string;
      conta: string;
      favorecidoNome: string;
      favorecidoCnpj: string;
    };
    return {
      referencia: data.referencia || opts.referencia,
      simulado: false,
      banco: data.banco,
      agencia: data.agencia,
      conta: data.conta,
      favorecidoNome: data.favorecidoNome,
      favorecidoCnpj: data.favorecidoCnpj,
    };
  }
  if (lastroStaticAccountConfigured) {
    return {
      referencia: opts.referencia,
      simulado: false,
      banco: lastroBanco!,
      agencia: lastroAgencia!,
      conta: lastroConta!,
      favorecidoNome: 'Lastro Tecnologia Ltda',
      favorecidoCnpj: lastroCnpj!,
    };
  }
  logger.info({ referencia: opts.referencia, valor: opts.valor }, '[ted] (simulado) instrução de TED seria emitida — configure TED_PSP_* ou LASTRO_TED_* para exibir dados bancários reais');
  return {
    referencia: opts.referencia,
    simulado: true,
    banco: '000 (simulado)',
    agencia: '0001',
    conta: '000000-0',
    favorecidoNome: 'Lastro Tecnologia Ltda (demo)',
    favorecidoCnpj: '00.000.000/0001-00',
  };
}

export interface TedPayoutResult {
  ok: boolean;
  simulado: boolean;
  protocolo: string | null;
}

export async function enviarTed(opts: {
  banco: string;
  agencia: string;
  conta: string;
  tipoConta: 'corrente' | 'poupanca';
  favorecidoNome: string;
  favorecidoCnpj: string;
  valor: number;
  descricao: string;
}): Promise<TedPayoutResult> {
  if (!tedEnabled) {
    logger.info({ favorecido: opts.favorecidoNome, valor: opts.valor }, '[ted] (simulado) TED de saída seria enviado — configure TED_PSP_* para enviar de verdade');
    return { ok: true, simulado: true, protocolo: null };
  }
  const token = await getAccessToken();
  const res = await fetch(`${baseUrl}/ted/enviar`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      valor: opts.valor.toFixed(2),
      favorecido: {
        banco: opts.banco,
        agencia: opts.agencia,
        conta: opts.conta,
        tipoConta: opts.tipoConta,
        nome: opts.favorecidoNome,
        cnpj: opts.favorecidoCnpj.replace(/\D/g, ''),
      },
      descricao: opts.descricao.slice(0, 140),
    }),
  });
  if (!res.ok) throw new Error(`ted_payout_failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { protocolo?: string };
  return { ok: true, simulado: false, protocolo: data.protocolo ?? null };
}

// Real webhook payload shape from a TED_PSP_*-configured BaaS provider (generic — same
// caveat as Pix/boleto's webhooks: real anti-spoofing is mTLS/IP allowlist at the
// provider's infra level, not faked here). Only relevant when tedEnabled — the static
// Lastro-account path is always confirmed by an admin instead, never a webhook.
export function parseWebhookTedRecebido(body: unknown): { referencia: string; valor: number }[] {
  const teds = (body as { teds?: unknown } | null)?.teds;
  if (!Array.isArray(teds)) return [];
  return teds
    .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
    .map((t) => ({ referencia: String(t.referencia ?? ''), valor: parseFloat(String(t.valor ?? '0')) || 0 }))
    .filter((t) => t.referencia);
}
