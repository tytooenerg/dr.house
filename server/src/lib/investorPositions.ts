// purchases.valor tem dois significados dependendo da origem da compra: valor de face numa
// compra primária/cesta/Confirming (market.ts, cestasCore.ts, confirmingCore.ts sempre
// chamam createPurchase com duplicata.valor), mas preço pago numa compra originada de
// revenda (resaleCore.ts's executeResaleTrade passa o preço da revenda) — ver o comentário
// de listPurchasesByInvestor em db/duplicatas.ts.
//
// Esta função era copiada literalmente em 4 arquivos (routes/historico.ts,
// lib/institutionalReporting.ts, lib/investorPerformance.ts, lib/portfolioRebalance.ts),
// cada um com sua própria versão do comentário abaixo. Como o dashboard passou a precisar
// do mesmo número, virou fonte única em vez de uma quinta cópia: são todos "quanto dinheiro
// de fato saiu do bolso do investidor pra abrir esta posição", e uma divergência entre eles
// seria um bug silencioso (o mesmo investidor veria totais diferentes em telas diferentes).
export interface PositionPricing {
  faceValor: number;
  retorno: number;
  valor: number;
  active: number;
}

// Dinheiro que de fato saiu do bolso do investidor para abrir esta posição.
//
// Só vale recuperar via `faceValor - retorno` enquanto a posição ainda está ativa: retorno
// = faceValor - preço pago é uma identidade real enquanto a posição nunca foi revendida,
// mas deactivatePurchase (db/resaleListings.ts) sobrescreve retorno com o ganho/perda
// REALIZADO da revenda assim que a posição é fechada — nesse ponto p.valor (nunca tocado
// por deactivatePurchase) já é o registro correto e final de quanto foi investido para
// abrir aquela posição encerrada, e recalcular por cima dele corromperia um número que já
// estava certo.
export function precoPago(p: PositionPricing): number {
  return p.active ? p.faceValor - p.retorno : p.valor;
}
