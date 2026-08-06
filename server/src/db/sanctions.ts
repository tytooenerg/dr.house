import { db } from './index.js';
import { screenAgainstLiveFeed, screenAgainstPaidProvider } from '../lib/sanctionsFeed.js';
import { isPlausiblySameEntity } from '../lib/pldSecondOpinion.js';

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
export async function screenEntity(nome: string, cnpj: string, userId?: number): Promise<SanctionsMatch | null> {
  const cnpjDigits = cnpj.replace(/\D/g, '');
  if (cnpjDigits) {
    const byCnpj = db.prepare('SELECT nome, tipo FROM sanctions_watchlist_demo WHERE cnpj = ?').get(cnpjDigits) as
      | { nome: string; tipo: 'sancao' | 'pep' }
      | undefined;
    if (byCnpj) return { ...byCnpj, fonte: 'demonstracao' };
  }
  const trimmedNome = nome.trim();
  if (!trimmedNome) return null;

  // A paid PLD provider is an authoritative external decision, not a naive match we
  // computed ourselves — it isn't second-guessed here the way the substring matches below
  // are.
  const providerHit = await screenAgainstPaidProvider(trimmedNome, cnpj);
  if (providerHit) return { nome: providerHit.nome, tipo: 'sancao', fonte: 'provedor_pld' };

  // OFAC and the demo table are matched by plain substring (see lib/sanctionsFeed.ts) —
  // good recall, weak precision — so a real hit goes through a Claude second opinion
  // before actually flagging the account (see lib/pldSecondOpinion.ts). Unconfigured or on
  // failure, isPlausiblySameEntity defaults to true, so behavior is unchanged from before
  // this feature existed.
  const liveHit = await screenAgainstLiveFeed(trimmedNome);
  if (liveHit && (await isPlausiblySameEntity(trimmedNome, liveHit.nome, 'OFAC SDN', userId))) {
    return { nome: liveHit.nome, tipo: 'sancao', fonte: 'ofac' };
  }

  const rows = db.prepare('SELECT nome, tipo FROM sanctions_watchlist_demo').all() as { nome: string; tipo: 'sancao' | 'pep' }[];
  const needle = trimmedNome.toLowerCase();
  const demoHit = rows.find((r) => r.nome.toLowerCase().includes(needle) || needle.includes(r.nome.toLowerCase().split(' (')[0]));
  if (demoHit && (await isPlausiblySameEntity(trimmedNome, demoHit.nome, 'watchlist de demonstração', userId))) {
    return { ...demoHit, fonte: 'demonstracao' };
  }
  return null;
}
