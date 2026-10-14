import { parseFlexibleDate, toIsoUtc } from './format.js';

// purchases.valor é, em toda linha, quanto o investidor PAGOU para abrir a posição — numa
// compra primária (lib/auctionClose.ts) e numa revenda (lib/resaleCore.ts) igualmente. Até
// a migração 0080 a compra primária guardava o valor de face, e esta função remendava isso
// com `faceValor − retorno` — o que só funcionava enquanto a posição estava ativa: ao ser
// revendida, deactivatePurchase sobrescreve retorno com o ganho realizado, e a tela passava
// a mostrar a face como "investido".
//
// Mantida como função (e não `p.valor` espalhado) porque é a fonte única usada por
// Histórico, relatório institucional, performance, rebalanceamento e dashboard.
export interface PositionPricing {
  faceValor: number;
  retorno: number;
  valor: number;
  active: number;
}

/** Dinheiro que de fato saiu do bolso do investidor para abrir esta posição. */
export function precoPago(p: PositionPricing): number {
  return p.valor;
}

/**
 * Quando o rendimento da posição aconteceu: na revenda, se o investidor saiu antes
 * (encerrada_em, migração 0081), senão no vencimento da duplicata. Fonte única para DARF,
 * Informe de Rendimentos, agente fiscal e performance — todos usavam o vencimento mesmo para
 * quem já tinha vendido a posição.
 */
export function dataDeResgate(p: { active: number; encerrada_em: string | null; vencimento: string }): { data: Date; evento: 'revenda' | 'vencimento' } {
  if (!p.active && p.encerrada_em) return { data: new Date(toIsoUtc(p.encerrada_em)), evento: 'revenda' };
  return { data: parseFlexibleDate(p.vencimento), evento: 'vencimento' };
}
