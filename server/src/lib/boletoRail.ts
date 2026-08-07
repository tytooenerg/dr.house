import { logger } from './logger.js';

// Real boleto registration rail — most Brazilian banks (Itaú, Banco do Brasil, Santander,
// Bradesco…) expose their own "registro de boleto" REST API under their own OAuth2
// developer portal; there's no single BACEN-mandated shape the way Pix's cobrança API is
// standardized, so (same as lib/paymentRail.ts's PIX_PAYOUT_PATH) this targets a generic,
// reasonably representative REST contract meant to be adjusted once you have real API
// docs from your specific banking partner. Real HTTP calls happen only when
// BOLETO_PSP_* is configured; otherwise every function clearly logs and returns a
// `simulado: true` result so deposits still work in local/demo use.

const baseUrl = process.env.BOLETO_PSP_BASE_URL;
const clientId = process.env.BOLETO_PSP_CLIENT_ID;
const clientSecret = process.env.BOLETO_PSP_CLIENT_SECRET;
const cedenteCnpj = process.env.BOLETO_CEDENTE_CNPJ;

export const boletoEnabled = !!(baseUrl && clientId && clientSecret && cedenteCnpj);

if (boletoEnabled) logger.info('[boleto] PSP configurado — emissão real de boleto habilitada');
else logger.info('[boleto] BOLETO_PSP_* não configurado — boletos serão simulados localmente');

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token;
  const res = await fetch(`${baseUrl}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
    },
    body: 'grant_type=client_credentials&scope=boletos.write boletos.read',
  });
  if (!res.ok) throw new Error(`boleto_oauth_failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: data.access_token, expiresAt: Date.now() + Math.max(1, data.expires_in - 30) * 1000 };
  return cachedToken.token;
}

export interface BoletoResult {
  nossoNumero: string;
  simulado: boolean;
  linhaDigitavel: string | null;
  codigoBarras: string | null;
  pdfUrl: string | null;
}

export async function emitirBoleto(opts: { nossoNumero: string; valor: number; vencimento: string; pagadorNome: string; pagadorCnpj?: string; descricao: string }): Promise<BoletoResult> {
  if (!boletoEnabled) {
    logger.info({ nossoNumero: opts.nossoNumero, valor: opts.valor }, '[boleto] (simulado) boleto seria emitido — configure BOLETO_PSP_* para gerar um boleto real');
    return { nossoNumero: opts.nossoNumero, simulado: true, linhaDigitavel: null, codigoBarras: null, pdfUrl: null };
  }
  const token = await getAccessToken();
  const res = await fetch(`${baseUrl}/boletos`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nossoNumero: opts.nossoNumero,
      valor: opts.valor.toFixed(2),
      dataVencimento: opts.vencimento,
      cedente: { cnpj: cedenteCnpj },
      pagador: { nome: opts.pagadorNome, cnpj: opts.pagadorCnpj?.replace(/\D/g, '') },
      descricao: opts.descricao.slice(0, 140),
    }),
  });
  if (!res.ok) throw new Error(`boleto_emit_failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { nossoNumero?: string; linhaDigitavel?: string; codigoBarras?: string; pdfUrl?: string };
  return {
    nossoNumero: data.nossoNumero || opts.nossoNumero,
    simulado: false,
    linhaDigitavel: data.linhaDigitavel ?? null,
    codigoBarras: data.codigoBarras ?? null,
    pdfUrl: data.pdfUrl ?? null,
  };
}

// Real boleto webhook payload shape varies per bank; this expects the common
// { nossoNumero, valorPago } shape most "registro de boleto" APIs use for payment
// notifications. Same anti-spoofing caveat as Pix's webhook (lib/paymentRail.ts): real
// verification is mTLS/IP allowlist at the banking partner's infra level, not faked here.
export function parseWebhookBoletoPago(body: unknown): { nossoNumero: string; valorPago: number }[] {
  const eventos = (body as { boletos?: unknown } | null)?.boletos;
  if (!Array.isArray(eventos)) return [];
  return eventos
    .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
    .map((e) => ({ nossoNumero: String(e.nossoNumero ?? ''), valorPago: parseFloat(String(e.valorPago ?? '0')) || 0 }))
    .filter((e) => e.nossoNumero);
}
