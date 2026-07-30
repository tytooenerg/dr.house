import { db } from './index.js';

export interface SanctionsMatch {
  nome: string;
  tipo: 'sancao' | 'pep';
}

// DEMONSTRATION-ONLY screening against the fictitious sanctions_watchlist_demo table
// seeded in migration 0011. This is NOT a live OFAC/COAF/CVM feed — a real deployment
// must integrate a licensed PLD/FT data vendor instead. Matches by exact CNPJ (digits
// only) or by company-name substring, case-insensitive.
export function screenEntity(nome: string, cnpj: string): SanctionsMatch | null {
  const cnpjDigits = cnpj.replace(/\D/g, '');
  if (cnpjDigits) {
    const byCnpj = db.prepare('SELECT nome, tipo FROM sanctions_watchlist_demo WHERE cnpj = ?').get(cnpjDigits) as
      | SanctionsMatch
      | undefined;
    if (byCnpj) return byCnpj;
  }
  const trimmedNome = nome.trim();
  if (!trimmedNome) return null;
  const rows = db.prepare('SELECT nome, tipo FROM sanctions_watchlist_demo').all() as SanctionsMatch[];
  const needle = trimmedNome.toLowerCase();
  return rows.find((r) => r.nome.toLowerCase().includes(needle) || needle.includes(r.nome.toLowerCase().split(' (')[0])) ?? null;
}
