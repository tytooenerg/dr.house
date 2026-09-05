import { z } from 'zod';
import { listMarketplace, isPurchased, createPurchase } from '../db/duplicatas.js';
import { getAceiteByDuplicata } from '../db/aceites.js';
import { recordAuditEvent } from '../db/audit.js';
import { deliverWebhookEvent } from './webhookDelivery.js';
import { informarNegociacao, type RegistradoraKey } from './registradoras.js';
import { settlePurchase } from './settlement.js';
import { computePurchasePrice, effectiveMonthlyRatePct } from './marketCompute.js';
import { estimateRateBand } from './dynamicPricing.js';
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

// Achado corrigido: uma duplicata só pode ser negociada depois que o sacado aceita
// (explícito ou tácito) — antes só se excluía 'contestada', 'aguardando' passava
// normalmente. Defesa em profundidade além do bloqueio em dispararLeilao.
function isBuyable(d: DuplicataRow): boolean {
  if (isPurchased(d.id)) return false;
  const aceite = getAceiteByDuplicata(d.id);
  return aceite?.status === 'aceita';
}

function fmtPct(n: number): string {
  return n.toFixed(2).replace('.', ',') + '%';
}

export interface CestaRange {
  minFmt: string;
  maxFmt: string;
  medioFmt: string;
  // true = calculada a partir de ofertas de fato compráveis agora (effectiveMonthlyRatePct
  // de cada uma); false = a cesta está vazia neste instante e a faixa caiu pra banda
  // teórica por classe (estimateRateBand) — mesmo espírito de "simulado quando não há
  // dado real" já usado no resto do código, nunca finge uma faixa real que não existe.
  real: boolean;
}

// Faixa de deságio desta cesta agora, mesclando automaticamente todas as classes que ela
// aceita — olha as ofertas de TODAS elas juntas (sem peso arbitrário por classe: o peso
// real é "quanto tem aberto pra comprar agora em cada uma", não um número inventado).
export function buildCestaRange(ratings: Rating[]): CestaRange {
  const ofertas = listMarketplace()
    .filter(isBuyable)
    .filter((d) => ratings.includes(ratingForOffer(d)));
  if (ofertas.length > 0) {
    const taxas = ofertas.map(effectiveMonthlyRatePct);
    const min = Math.min(...taxas);
    const max = Math.max(...taxas);
    const media = taxas.reduce((s, t) => s + t, 0) / taxas.length;
    return { minFmt: fmtPct(min), maxFmt: fmtPct(max), medioFmt: fmtPct(media), real: true };
  }
  const bands = ratings.map((r) => estimateRateBand(r));
  const min = Math.min(...bands.map((b) => b.min));
  const max = Math.max(...bands.map((b) => b.max));
  const media = bands.reduce((s, b) => s + b.mid, 0) / bands.length;
  return { minFmt: fmtPct(min), maxFmt: fmtPct(max), medioFmt: fmtPct(media), real: false };
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
    // Affordability and the running budget are checked against precoCompra — what the
    // investor's ledger actually gets debited (lib/settlement.ts's settlePurchase) — not
    // the duplicata's face value, which is only what comes back at maturity.
    const { precoCompra } = computePurchasePrice(d);
    if (precoCompra > remaining) continue;
    createPurchase(d.id, user.id, d.valor, d.desagio ?? '', Math.round(d.valor - precoCompra));
    settlePurchase({ duplicataId: d.id, sacadoNome: d.sacado_nome, investorId: user.id, cedenteId: d.cedente_id, valor: d.valor, precoCompra });
    // Res. BCB nº 540/2025 — ver comentário de informarNegociacao (lib/registradoras.ts).
    void informarNegociacao({ registradoraKey: d.registradora as RegistradoraKey | null, duplicataId: d.id, evento: 'compra', valor: precoCompra });
    if (d.cedente_id) {
      void deliverWebhookEvent(d.cedente_id, 'pagamento.confirmado', { duplicataId: d.id, valor: d.valor, investorId: user.id });
    }
    comprados.push({ duplicataId: d.id, sacado: d.sacado_nome, rating: ratingForOffer(d), valorFmt: fmtBRL(d.valor), desagio: d.desagio ?? '—' });
    remaining -= precoCompra;
  }

  recordAuditEvent(user.id, user.company_name, 'cesta.investido', { cesta: cestaKey, budget, comprados: comprados.length });

  const investido = Math.round(budget - remaining);

  return {
    status: 200,
    body: {
      comprados,
      // Arredonda UMA vez e deriva o outro do valor já arredondado: `fmtBRL` usa
      // maximumFractionDigits: 0, então formatar `budget - remaining` e `remaining`
      // independentemente pode arredondar os dois pra cima e exibir um par que soma R$ 1 a
      // mais que o orçamento ("investido R$ 15.782 + restante R$ 999.984.218" pra um
      // orçamento de R$ 999.999.999). Derivando, investido + restante fecha sempre.
      totalInvestidoFmt: fmtBRL(investido),
      restanteFmt: fmtBRL(budget - investido),
      ofertasDisponiveis: candidates.length,
    },
  };
}
