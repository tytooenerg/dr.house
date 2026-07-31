import { logger } from './logger.js';

// Adapter for a real Brazilian credit bureau (Serasa Experian, Boa Vista SCPC, Quod) —
// the kind of external data source riscoCore's score is missing today (it blends Lastro's
// own seeded profile with cross-platform network signals, but never an actual bureau).
// Requires a real commercial contract this environment can't provide, so it's a no-op
// until BUREAU_API_URL/KEY are set — same honest pattern as lib/paymentRail.ts and
// lib/registradoras.ts.
const bureauUrl = process.env.BUREAU_API_URL;
const bureauKey = process.env.BUREAU_API_KEY;
export const bureauEnabled = !!(bureauUrl && bureauKey);

if (bureauEnabled) logger.info('[bureau] provedor de score de crédito configurado — score externo será combinado ao score interno');
else logger.info('[bureau] BUREAU_API_URL/KEY não configurado — score de crédito segue apenas interno + rede');

export interface BureauScore {
  score: number; // normalized 0-100, matching riscoCore's own scale
  fonte: string;
}

export async function consultarBureau(cnpj: string): Promise<BureauScore | null> {
  if (!bureauEnabled) return null;
  const res = await fetch(`${bureauUrl}/score/${cnpj.replace(/\D/g, '')}`, {
    headers: { Authorization: `Bearer ${bureauKey}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`bureau_fetch_failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { score: number; fonte?: string };
  return { score: Math.max(0, Math.min(100, Math.round(data.score))), fonte: data.fonte || 'bureau' };
}
