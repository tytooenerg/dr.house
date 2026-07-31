import { db } from './index.js';
import { screenAgainstLiveFeed, screenAgainstPaidProvider } from '../lib/sanctionsFeed.js';

export interface SanctionsMatch {
  nome: string;
  tipo: 'sancao' | 'pep';
  fonte: 'provedor_pld' | 'ofac' | 'demonstracao';
}

// Screening priority: a licensed commercial PLD/KYC provider first (if PLD_PROVIDER_API_*
// is configured — the real thing production compliance runs on), then OFAC's free public
// SDN list (if SANCTIONS_LIVE_FEED=true), then the fictitious demo watchlist as a final
// fallback so onboarding is still exercised with zero configuration. Neither the paid
// provider nor OFAC carry Brazilian CNPJ data reliably, so CNPJ-exact-match only ever
// comes from the demo table.
export async function screenEntity(nome: string, cnpj: string): Promise<SanctionsMatch | null> {
  const cnpjDigits = cnpj.replace(/\D/g, '');
  if (cnpjDigits) {
    const byCnpj = db.prepare('SELECT nome, tipo FROM sanctions_watchlist_demo WHERE cnpj = ?').get(cnpjDigits) as
      | { nome: string; tipo: 'sancao' | 'pep' }
      | undefined;
    if (byCnpj) return { ...byCnpj, fonte: 'demonstracao' };
  }
  const trimmedNome = nome.trim();
  if (!trimmedNome) return null;

  const providerHit = await screenAgainstPaidProvider(trimmedNome, cnpj);
  if (providerHit) return { nome: providerHit.nome, tipo: 'sancao', fonte: 'provedor_pld' };

  const liveHit = await screenAgainstLiveFeed(trimmedNome);
  if (liveHit) return { nome: liveHit.nome, tipo: 'sancao', fonte: 'ofac' };

  const rows = db.prepare('SELECT nome, tipo FROM sanctions_watchlist_demo').all() as { nome: string; tipo: 'sancao' | 'pep' }[];
  const needle = trimmedNome.toLowerCase();
  const demoHit = rows.find((r) => r.nome.toLowerCase().includes(needle) || needle.includes(r.nome.toLowerCase().split(' (')[0]));
  return demoHit ? { ...demoHit, fonte: 'demonstracao' } : null;
}
