import { logger } from './logger.js';

// Real stablecoin settlement rail (USDC/USDT/BRLA...) — a fourth deposit/withdraw method
// alongside Pix, boleto and TED, aimed mainly at two cases those three don't cover well:
// a non-resident (INR) investor funding a position without a manual SWIFT/câmbio step
// (see lib/foreignInvestorCompliance.ts — same regulatory boundary applies here, see
// below), and settlement outside Pix/TED banking hours.
//
// Same shape as every other rail here, but modeled specifically on lib/tedRail.ts rather
// than lib/paymentRail.ts (Pix) — on purpose. There is no BACEN-style standardized
// "confirm this cobrança" API for a stablecoin transfer, and unlike Pix/boleto a user
// self-attesting "I sent it" cannot be trusted any more than a user self-attesting a TED
// landed (an on-chain explorer isn't something this server can honestly treat as verified
// input from the browser). So: a real custodial/VASP provider (STABLECOIN_PSP_*) gives a
// per-deposit address and a real webhook confirmation; without one, deposits fall back to
// Lastro's own static receiving wallet (LASTRO_STABLECOIN_WALLET_ADDRESS) with a reference
// an admin matches by hand against the real chain explorer — never a self-service
// "confirmar (simulado)" button. Neither configured = fully simulated wallet data.
//
// The regulatory point that matters more than the code: since Lei 14.478/2022 and the
// Banco Central's 2025 regulation of "prestadores de serviço de ativos virtuais" (VASPs),
// custodying or converting stablecoin on behalf of third parties is itself an authorized
// activity — Lastro cannot become that authorized party just by setting an env var, the
// same way PIX_PSP_* works because the PSP behind it is already BACEN-licensed.
// STABLECOIN_PSP_* is meant to point at an already-licensed custodial/VASP partner's API,
// not to make Lastro one. See docs referenced in DEPLOY.md before moving real value here.

const baseUrl = process.env.STABLECOIN_PSP_BASE_URL;
const clientId = process.env.STABLECOIN_PSP_CLIENT_ID;
const clientSecret = process.env.STABLECOIN_PSP_CLIENT_SECRET;

export const stablecoinEnabled = !!(baseUrl && clientId && clientSecret);

export const stablecoinAsset = process.env.STABLECOIN_ASSET || 'USDC';
export const stablecoinNetwork = process.env.STABLECOIN_NETWORK || 'polygon';

const lastroWalletAddress = process.env.LASTRO_STABLECOIN_WALLET_ADDRESS;
export const lastroStaticWalletConfigured = !!lastroWalletAddress;

if (stablecoinEnabled) {
  logger.info({ asset: stablecoinAsset, network: stablecoinNetwork }, '[stablecoin] custodiante/VASP configurado — endereço de depósito dedicado e confirmação via webhook habilitados');
} else if (lastroStaticWalletConfigured) {
  logger.info({ asset: stablecoinAsset, network: stablecoinNetwork }, '[stablecoin] LASTRO_STABLECOIN_WALLET_ADDRESS configurado — depósitos usam a carteira real da Lastro, confirmação manual pelo time');
} else {
  logger.info('[stablecoin] STABLECOIN_PSP_*/LASTRO_STABLECOIN_WALLET_ADDRESS não configurados — endereços de depósito serão simulados');
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
    body: 'grant_type=client_credentials&scope=deposits.write deposits.read transfers.write',
  });
  if (!res.ok) throw new Error(`stablecoin_oauth_failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: data.access_token, expiresAt: Date.now() + Math.max(1, data.expires_in - 30) * 1000 };
  return cachedToken.token;
}

export interface StablecoinDepositInstruction {
  referencia: string;
  simulado: boolean;
  asset: string;
  network: string;
  endereco: string;
}

export async function emitirInstrucaoStablecoin(opts: { referencia: string; valor: number }): Promise<StablecoinDepositInstruction> {
  if (stablecoinEnabled) {
    const token = await getAccessToken();
    const res = await fetch(`${baseUrl}/deposits/enderecos`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ referencia: opts.referencia, asset: stablecoinAsset, network: stablecoinNetwork, valorEsperado: opts.valor.toFixed(2) }),
    });
    if (!res.ok) throw new Error(`stablecoin_instrucao_failed: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { referencia?: string; endereco: string };
    return { referencia: data.referencia || opts.referencia, simulado: false, asset: stablecoinAsset, network: stablecoinNetwork, endereco: data.endereco };
  }
  if (lastroStaticWalletConfigured) {
    return { referencia: opts.referencia, simulado: false, asset: stablecoinAsset, network: stablecoinNetwork, endereco: lastroWalletAddress! };
  }
  logger.info({ referencia: opts.referencia, valor: opts.valor }, '[stablecoin] (simulado) endereço de depósito seria emitido — configure STABLECOIN_PSP_* ou LASTRO_STABLECOIN_WALLET_ADDRESS para exibir um endereço real');
  return { referencia: opts.referencia, simulado: true, asset: stablecoinAsset, network: stablecoinNetwork, endereco: '0x0000000000000000000000000000000000dEMO' };
}

export interface StablecoinPayoutResult {
  ok: boolean;
  simulado: boolean;
  txHash: string | null;
}

export async function enviarStablecoin(opts: { enderecoDestino: string; valor: number; descricao: string }): Promise<StablecoinPayoutResult> {
  if (!stablecoinEnabled) {
    logger.info({ endereco: opts.enderecoDestino, valor: opts.valor }, '[stablecoin] (simulado) saque seria enviado on-chain — configure STABLECOIN_PSP_* para enviar de verdade');
    return { ok: true, simulado: true, txHash: null };
  }
  const token = await getAccessToken();
  const res = await fetch(`${baseUrl}/transfers`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ endereco: opts.enderecoDestino, asset: stablecoinAsset, network: stablecoinNetwork, valor: opts.valor.toFixed(2), descricao: opts.descricao.slice(0, 140) }),
  });
  if (!res.ok) throw new Error(`stablecoin_payout_failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { txHash?: string };
  return { ok: true, simulado: false, txHash: data.txHash ?? null };
}

// Real webhook payload shape from a STABLECOIN_PSP_*-configured custodiante/VASP; only
// relevant when stablecoinEnabled — the static-wallet path is always confirmed by an
// admin instead (POST /admin/stablecoin/:referencia/confirmar), never here. Same
// anti-spoofing caveat as every other rail's webhook: real verification is mTLS/IP
// allowlist at the provider's infra level, not faked here.
export function parseWebhookStablecoinRecebido(body: unknown): { referencia: string; valor: number; txHash: string | null }[] {
  const transfers = (body as { transfers?: unknown } | null)?.transfers;
  if (!Array.isArray(transfers)) return [];
  return transfers
    .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
    .map((t) => ({
      referencia: String(t.referencia ?? ''),
      valor: parseFloat(String(t.valor ?? '0')) || 0,
      txHash: typeof t.txHash === 'string' ? t.txHash : null,
    }))
    .filter((t) => t.referencia);
}
