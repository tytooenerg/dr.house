import { logger } from './logger.js';

// Real-when-configured adapter for a commercial Open Finance Brasil aggregator (Pluggy,
// Belvo, Quanto-style) — the current frontier for credit-risk data in Brazil: real bank
// account/transaction data with the sacado's consent, instead of only self-reported or
// third-party-inferred signals. Requires a real commercial contract + the aggregator's own
// hosted consent-redirect flow (the sacado authorizes access at their own bank) this
// environment can't stand up — this adapter only covers the *data pull* once consent
// already exists via the aggregator, not the consent UX itself. No-op until
// OPEN_FINANCE_API_URL/KEY are set, same honest pattern as lib/creditBureau.ts.
const apiUrl = process.env.OPEN_FINANCE_API_URL;
const apiKey = process.env.OPEN_FINANCE_API_KEY;
export const openFinanceEnabled = !!(apiUrl && apiKey);

if (openFinanceEnabled) logger.info('[open-finance] agregador configurado — sinal de fluxo de caixa real habilitado');
else logger.info('[open-finance] OPEN_FINANCE_API_URL/KEY não configurado — sinal de fluxo de caixa via Open Finance desativado');

export interface OpenFinanceCashFlowSignal {
  receitaMediaMensal: number;
  volatilidadePct: number; // coefficient of variation of monthly revenue, 0-100 — lower is more predictable
  saldoMedio: number;
  fonte: string;
}

// 404 means the aggregator has no active consent on file for this CNPJ yet (the sacado
// never went through the Open Finance authorization flow with them) — a real "no data",
// not an error.
export async function consultarFluxoDeCaixa(cnpj: string): Promise<OpenFinanceCashFlowSignal | null> {
  if (!openFinanceEnabled) return null;
  const digits = cnpj.replace(/\D/g, '');
  if (!digits) return null;
  const res = await fetch(`${apiUrl}/cnpj/${digits}/fluxo-de-caixa`, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`open_finance_fetch_failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { receitaMediaMensal?: number; volatilidadePct?: number; saldoMedio?: number };
  return {
    receitaMediaMensal: data.receitaMediaMensal ?? 0,
    volatilidadePct: Math.max(0, Math.min(100, data.volatilidadePct ?? 0)),
    saldoMedio: data.saldoMedio ?? 0,
    fonte: 'open_finance',
  };
}
