import { z } from 'zod';
import { listMarketplace, isPurchased, createPurchase } from '../db/duplicatas.js';
import { getAceiteByDuplicata } from '../db/aceites.js';
import { recordAuditEvent } from '../db/audit.js';
import { deliverWebhookEvent } from './webhookDelivery.js';
import { settlePurchase } from './settlement.js';
import { fmtBRL, parseBRLNumber } from './format.js';
import { SACADOS, type Rating } from '../data/seed.js';
import { checkCestaSuitability } from './suitability.js';
import type { DuplicataRow, UserRow } from '../db/types.js';

export const CESTAS = {
  conservadora: { label: 'Conservadora', desc: 'Só sacados AA/A — menor risco, menor deságio.', ratings: ['AA', 'A'] as Rating[] },
  diversificada: { label: 'Diversificada', desc: 'Mistura de todos os ratings, priorizando os melhores scores primeiro.', ratings: ['AA', 'A', 'B', 'C'] as Rating[] },
  agressiva: { label: 'Agressiva', desc: 'Só sacados B/C — maior deságio, maior risco.', ratings: ['B', 'C'] as Rating[] },
} as const;

export type CestaKey = keyof typeof CESTAS;

function ratingForOffer(d: DuplicataRow): Rating {
  const known = SACADOS[d.sacado_nome]?.rating;
  if (known) return known;
  const score = d.score ?? 60;
  if (score >= 80) return 'AA';
  if (score >= 65) return 'A';
  if (score >= 45) return 'B';
  return 'C';
}

function isBuyable(d: DuplicataRow): boolean {
  if (isPurchased(d.id)) return false;
  const aceite = getAceiteByDuplicata(d.id);
  return aceite?.status !== 'contestada';
}

export const investSchema = z.object({ cesta: z.enum(['conservadora', 'diversificada', 'agressiva']), valor: z.string().trim() });

export type InvestOutcome =
  | {
      status: 200;
      body: {
        comprados: { duplicataId: string; sacado: string; rating: Rating; valorFmt: string; desagio: string }[];
        totalInvestidoFmt: string;
        restanteFmt: string;
        ofertasDisponiveis: number;
      };
    }
  | { status: 400; body: { error: 'validation_error'; message: string } }
  | { status: 403; body: { error: 'forbidden' | 'kyb_required' | 'suitability_required' | 'suitability_mismatch'; message: string } }
  | { status: 409; body: { error: 'no_offers'; message: string } };

// One-shot allocation, not continuous automation (see automation.ts for the ongoing
// auto-bid engine) — greedily buys whole duplicatas matching the basket's rating profile,
// best score first, until the budget runs out or no more matching offers fit.
export function investInBasket(user: UserRow, cestaKey: CestaKey, valorRaw: string): InvestOutcome {
  if (user.role !== 'investidor') {
    return { status: 403, body: { error: 'forbidden', message: 'Apenas contas de investidor podem usar as cestas de investimento.' } };
  }
  if (user.kyb_status !== 'approved') {
    return { status: 403, body: { error: 'kyb_required', message: 'Seu credenciamento institucional ainda está em análise.' } };
  }
  // See lib/suitability.ts — a basket is the platform choosing where money goes, closer
  // to a recommendation than a manual "Comprar" click, so the riskier baskets require a
  // valid, non-expired suitability profile proving the investor's risk tolerance supports
  // it. 'conservadora' never requires one (an unknown risk tolerance is conservatively
  // assumed to be fine with the safest option).
  const suitability = checkCestaSuitability(user.id, cestaKey);
  if (!suitability.ok) {
    return { status: 403, body: { error: suitability.error, message: suitability.message } };
  }
  const budget = parseBRLNumber(valorRaw);
  if (budget <= 0) {
    return { status: 400, body: { error: 'validation_error', message: 'Informe um valor válido para investir.' } };
  }
  const cesta = CESTAS[cestaKey];
  const candidates = listMarketplace()
    .filter(isBuyable)
    .filter((d) => cesta.ratings.includes(ratingForOffer(d)))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  if (candidates.length === 0) {
    return { status: 409, body: { error: 'no_offers', message: 'Não há ofertas disponíveis no momento para o perfil desta cesta.' } };
  }

  let remaining = budget;
  const comprados: { duplicataId: string; sacado: string; rating: Rating; valorFmt: string; desagio: string }[] = [];
  for (const d of candidates) {
    if (d.valor > remaining) continue;
    createPurchase(d.id, user.id, d.valor, d.desagio ?? '');
    settlePurchase({ duplicataId: d.id, sacadoNome: d.sacado_nome, investorId: user.id, cedenteId: d.cedente_id, valor: d.valor });
    if (d.cedente_id) {
      void deliverWebhookEvent(d.cedente_id, 'pagamento.confirmado', { duplicataId: d.id, valor: d.valor, investorId: user.id });
    }
    comprados.push({ duplicataId: d.id, sacado: d.sacado_nome, rating: ratingForOffer(d), valorFmt: fmtBRL(d.valor), desagio: d.desagio ?? '—' });
    remaining -= d.valor;
  }

  recordAuditEvent(user.id, user.company_name, 'cesta.investido', { cesta: cestaKey, budget, comprados: comprados.length });

  return {
    status: 200,
    body: {
      comprados,
      totalInvestidoFmt: fmtBRL(budget - remaining),
      restanteFmt: fmtBRL(remaining),
      ofertasDisponiveis: candidates.length,
    },
  };
}
