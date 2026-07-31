import { logger } from './logger.js';

// Real Pix payment rail, implemented against BACEN's actual standardized "API Pix"
// contract (the same one every PSP — Banco Central-authorized institution — exposes):
//   PUT  /cob/{txid}   cria uma cobrança imediata (valor, devedor, chave do recebedor)
//   GET  /cob/{txid}   consulta status (ATIVA | CONCLUIDA | REMOVIDA_PELO_USUARIO_RECEBEDOR)
//   webhook PSP→Lastro notifica "pix recebido" quando o pagador paga a cobrança
// Outbound "Pix enviado" (payout) has no single BACEN-mandated endpoint shape the way
// cobrança does — every PSP exposes its own send/transfer API, so PIX_PAYOUT_PATH is
// deliberately configurable rather than hardcoded to one PSP's contract.
//
// Same honest pattern as lib/billing.ts's Stripe integration: real HTTP calls happen only
// when a PSP is actually configured; otherwise every function clearly logs and returns a
// `simulado: true` result so the rest of the app (and the demo) keeps working.

const baseUrl = process.env.PIX_PSP_BASE_URL;
const clientId = process.env.PIX_PSP_CLIENT_ID;
const clientSecret = process.env.PIX_PSP_CLIENT_SECRET;
const chaveRecebedor = process.env.PIX_CHAVE_RECEBEDOR;

export const pixEnabled = !!(baseUrl && clientId && clientSecret && chaveRecebedor);

if (pixEnabled) logger.info('[pix] PSP configurado — cobranças, confirmações e saques Pix reais habilitados');
else logger.info('[pix] PIX_PSP_* não configurado — depósitos e saques Pix serão simulados localmente');

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token;
  const res = await fetch(`${baseUrl}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
    },
    body: 'grant_type=client_credentials&scope=cob.write cob.read pix.write pix.read',
  });
  if (!res.ok) throw new Error(`pix_oauth_failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: data.access_token, expiresAt: Date.now() + Math.max(1, data.expires_in - 30) * 1000 };
  return cachedToken.token;
}

export interface CobrancaResult {
  txid: string;
  simulado: boolean;
  brcode: string | null; // "copia e cola" / QR code payload
}

export async function criarCobranca(opts: {
  txid: string;
  valor: number;
  devedorNome?: string;
  devedorCnpj?: string;
  descricao: string;
}): Promise<CobrancaResult> {
  if (!pixEnabled) {
    logger.info({ txid: opts.txid, valor: opts.valor }, '[pix] (simulado) cobrança seria criada — configure PIX_PSP_* para gerar um QR code real');
    return { txid: opts.txid, simulado: true, brcode: null };
  }
  const token = await getAccessToken();
  // `devedor` is optional in the Pix API spec — omitted when we don't have a reliable
  // CNPJ on file rather than sending a guessed/malformed one.
  const devedor = opts.devedorCnpj ? { cnpj: opts.devedorCnpj.replace(/\D/g, ''), nome: opts.devedorNome || '' } : undefined;
  const res = await fetch(`${baseUrl}/cob/${opts.txid}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      calendario: { expiracao: 3600 },
      ...(devedor ? { devedor } : {}),
      valor: { original: opts.valor.toFixed(2) },
      chave: chaveRecebedor,
      solicitacaoPagador: opts.descricao.slice(0, 140),
    }),
  });
  if (!res.ok) throw new Error(`pix_cob_failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { txid: string; pixCopiaECola?: string };
  return { txid: data.txid, simulado: false, brcode: data.pixCopiaECola ?? null };
}

export interface PayoutResult {
  ok: boolean;
  simulado: boolean;
  endToEndId: string | null;
}

export async function enviarPix(opts: { chaveDestino: string; valor: number; descricao: string }): Promise<PayoutResult> {
  if (!pixEnabled) {
    logger.info({ chave: opts.chaveDestino, valor: opts.valor }, '[pix] (simulado) saque Pix seria enviado — configure PIX_PSP_* para enviar de verdade');
    return { ok: true, simulado: true, endToEndId: null };
  }
  // No BACEN-standardized shape for outbound send exists — this path is per-PSP by
  // contract, so the exact route is deliberately env-configurable.
  const payoutPath = process.env.PIX_PAYOUT_PATH || '/pix/enviar';
  const token = await getAccessToken();
  const res = await fetch(`${baseUrl}${payoutPath}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ valor: opts.valor.toFixed(2), chave: opts.chaveDestino, descricao: opts.descricao.slice(0, 140) }),
  });
  if (!res.ok) throw new Error(`pix_payout_failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { endToEndId?: string };
  return { ok: true, simulado: false, endToEndId: data.endToEndId ?? null };
}

// Real Pix webhook payload shape (BACEN standard): { pix: [{ txid, valor, endToEndId, horario }, ...] }.
// Signature/origin verification for a real deployment is mTLS on the registered webhook
// URL itself (how BACEN's Pix webhook anti-spoofing actually works), not a header HMAC —
// that's PSP infrastructure this environment can't stand up, so it's not faked here.
export function parseWebhookPixRecebido(body: unknown): { txid: string; valor: number; endToEndId: string | null }[] {
  const pix = (body as { pix?: unknown } | null)?.pix;
  if (!Array.isArray(pix)) return [];
  return pix
    .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
    .map((p) => ({
      txid: String(p.txid ?? ''),
      valor: parseFloat(String(p.valor ?? '0')) || 0,
      endToEndId: typeof p.endToEndId === 'string' ? p.endToEndId : null,
    }))
    .filter((p) => p.txid);
}
