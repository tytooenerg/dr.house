import { addLedgerEntry } from '../db/misc.js';
import { recordInsuranceSettlement } from '../db/insuranceSettlements.js';
import { recordPlatformFeeEvent } from '../db/platformFeeEvents.js';
import { fmtBRL } from './format.js';

// Single source of truth for the platform fee — reused by the Emitir Duplicata preview
// (lib/emitirCore.ts) and here, at the moment money actually moves, so the number shown
// to a cedente before emitting is exactly the number that gets deducted at liquidação.
export function platformFeePct(valor: number): number {
  return valor > 1_000_000 ? 0.0025 : valor > 200_000 ? 0.003 : 0.0035;
}

export function platformFee(valor: number): number {
  return valor * platformFeePct(valor);
}

export function pctLabel(valor: number): string {
  const pct = platformFeePct(valor) * 100; // 0.35 | 0.3 | 0.25
  const str = pct.toFixed(2).replace(/0$/, '');
  return str.replace('.', ',') + '%';
}

function today(): string {
  return new Date().toLocaleDateString('pt-BR');
}

// Real settlement for a primary marketplace purchase (direct buy, via a cesta de
// investimento, an auto-bid, or the Programa Confirming's auto-financiamento) — the
// investor's ledger shows the real deságio-adjusted price actually leaving (precoCompra,
// from lib/marketCompute.ts's computePurchasePrice — always <= valor), the cedente's shows
// that same price received net of the platform fee (still computed on the face value,
// valor — the size of the receivable being anticipated, not what the investor happened to
// pay for it). The face value itself only comes back later, to whoever ends up holding the
// position, via settleAtMaturity below — that gap (precoCompra now vs. valor at maturity)
// is the investor's actual return for financing early; before this, precoCompra didn't
// exist and every caller passed the full face value here, so the deságio shown everywhere
// in the UI was never applied to any real money movement.
export function settlePurchase(opts: { duplicataId: string; sacadoNome: string; investorId: number; cedenteId: number | null; valor: number; precoCompra: number }) {
  const fee = platformFee(opts.valor);
  const net = opts.precoCompra - fee;
  addLedgerEntry(opts.investorId, today(), `Compra da duplicata ${opts.duplicataId} — ${opts.sacadoNome}`, -opts.precoCompra);
  if (opts.cedenteId) {
    addLedgerEntry(
      opts.cedenteId,
      today(),
      `Liquidação da duplicata ${opts.duplicataId} — taxa de plataforma ${pctLabel(opts.valor)} descontada (${fmtBRL(fee)})`,
      net
    );
  }
  recordPlatformFeeEvent(opts.duplicataId, opts.valor, fee, 'compra');
  return { fee, net, precoCompra: opts.precoCompra };
}

// Lastro's cut of the insurance premium — a real distribution commission, not a fee
// invented out of thin air: the seguradora sets the premium (INSURERS.premioPct), Lastro
// keeps a slice for originating the policy, and the seguradora gets the rest.
export const INSURANCE_COMMISSION_PCT = 0.18;

// Real settlement for a seguro contracted on the marketplace (POST /api/market/:id/insure)
// — the investor protecting their position pays the full premium, the seguradora (if a
// registered account exists for that insurer_key) receives it net of Lastro's commission.
// Every settlement is also logged to insurance_settlements for exact revenue reporting,
// since which insurer is "current" on a duplicata can change after the fact.
export function settleInsurance(opts: { duplicataId: string; investorId: number; insurerKey: string; insurerUserId: number | null; premio: number }) {
  const comissao = opts.premio * INSURANCE_COMMISSION_PCT;
  const repasse = opts.premio - comissao;
  addLedgerEntry(opts.investorId, today(), `Prêmio de seguro contratado — duplicata ${opts.duplicataId}`, -opts.premio);
  if (opts.insurerUserId) {
    addLedgerEntry(
      opts.insurerUserId,
      today(),
      `Prêmio recebido — duplicata ${opts.duplicataId} (líquido de ${Math.round(INSURANCE_COMMISSION_PCT * 100)}% de comissão da Lastro)`,
      repasse
    );
  }
  recordInsuranceSettlement({
    duplicataId: opts.duplicataId,
    investorId: opts.investorId,
    insurerKey: opts.insurerKey,
    premio: opts.premio,
    comissaoLastro: comissao,
    repasseSeguradora: repasse,
  });
  return { comissao, repasse };
}

// Real settlement for a duplicata paid by the sacado at maturity — the "caminho feliz" that
// closes a purchase's lifecycle when nothing goes wrong. Self-reported by the sacado
// (lib/aceiteCore.ts's reportPayment), mirroring lib/creditLine.ts's repayCreditLine: no
// real bank webhook exists to see this happen automatically. Whoever currently holds the
// receivable (legalCollectionFee.ts's currentCreditorFor) gets the full face value — the
// platform fee was already collected at purchase time (settlePurchase/settleResale), so
// nothing is deducted again here.
export function settleAtMaturity(opts: { duplicataId: string; creditorId: number; valor: number }) {
  addLedgerEntry(opts.creditorId, today(), `Pagamento recebido no vencimento — duplicata ${opts.duplicataId}`, opts.valor);
}

// Same fee schedule applies to trades on the mercado secundário — the platform still
// facilitates the transfer, so the reselling investor pays the fee out of their proceeds.
// feeDiscountPct (0-1) discounts the *platform's own fee* for institutional block trades
// (lib/blockTrade.ts). Nunca é uma redução no que o vendedor recebe (ele sempre recebe
// pelo menos valor − taxa cheia) — mas isso não é neutro pro vendedor como um comentário
// anterior chegou a sugerir: como não existe nenhuma conta de ledger representando "a
// plataforma" neste modelo, `net` abaixo é literalmente maior quando a taxa é menor —
// a plataforma abre mão da própria receita, e esse valor vira dinheiro extra pro
// vendedor, não fica com ninguém mais. Por dever de informação clara (CDC art. 6º, IV —
// não há exigência regulatória de neutralidade de taxa, Res. CMN 4.656/2018), o
// benefício em reais é explicitado na descrição do lançamento do vendedor abaixo.
export function settleResale(opts: { duplicataId: string; sacadoNome: string; buyerId: number; sellerId: number; valor: number; feeDiscountPct?: number }) {
  const baseFee = platformFee(opts.valor);
  const fee = baseFee * (1 - (opts.feeDiscountPct ?? 0));
  const beneficio = baseFee - fee;
  const net = opts.valor - fee;
  const feeLabel = opts.feeDiscountPct
    ? `${pctLabel(opts.valor)} com desconto institucional, ${fmtBRL(beneficio)} a menos que a taxa padrão`
    : pctLabel(opts.valor);
  addLedgerEntry(opts.buyerId, today(), `Compra no mercado secundário — duplicata ${opts.duplicataId} (${opts.sacadoNome})`, -opts.valor);
  addLedgerEntry(
    opts.sellerId,
    today(),
    `Venda no mercado secundário — duplicata ${opts.duplicataId}, taxa de plataforma ${feeLabel} descontada (${fmtBRL(fee)})`,
    net
  );
  recordPlatformFeeEvent(opts.duplicataId, opts.valor, fee, 'revenda');
  return { fee, net };
}
