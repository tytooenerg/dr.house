import { addLedgerEntry } from '../db/misc.js';
import { recordInsuranceSettlement } from '../db/insuranceSettlements.js';
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

// Real settlement for a primary marketplace purchase (direct buy, or via a cesta de
// investimento) — the investor's ledger shows the full amount leaving, the cedente's
// shows the amount received net of the platform fee. This is what "taxa de plataforma...
// descontada na liquidação" (shown in the Emitir preview) actually means happening.
export function settlePurchase(opts: { duplicataId: string; sacadoNome: string; investorId: number; cedenteId: number | null; valor: number }) {
  const fee = platformFee(opts.valor);
  const net = opts.valor - fee;
  addLedgerEntry(opts.investorId, today(), `Compra da duplicata ${opts.duplicataId} — ${opts.sacadoNome}`, -opts.valor);
  if (opts.cedenteId) {
    addLedgerEntry(
      opts.cedenteId,
      today(),
      `Liquidação da duplicata ${opts.duplicataId} — taxa de plataforma ${pctLabel(opts.valor)} descontada (${fmtBRL(fee)})`,
      net
    );
  }
  return { fee, net };
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
// (lib/blockTrade.ts) — a volume perk on what the platform charges itself, never a markdown
// on what the seller actually receives per unit of what they listed at.
export function settleResale(opts: { duplicataId: string; sacadoNome: string; buyerId: number; sellerId: number; valor: number; feeDiscountPct?: number }) {
  const baseFee = platformFee(opts.valor);
  const fee = baseFee * (1 - (opts.feeDiscountPct ?? 0));
  const net = opts.valor - fee;
  const feeLabel = opts.feeDiscountPct ? `${pctLabel(opts.valor)} com desconto institucional` : pctLabel(opts.valor);
  addLedgerEntry(opts.buyerId, today(), `Compra no mercado secundário — duplicata ${opts.duplicataId} (${opts.sacadoNome})`, -opts.valor);
  addLedgerEntry(
    opts.sellerId,
    today(),
    `Venda no mercado secundário — duplicata ${opts.duplicataId}, taxa de plataforma ${feeLabel} descontada (${fmtBRL(fee)})`,
    net
  );
  return { fee, net };
}
