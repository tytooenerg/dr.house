import { addLedgerEntry } from '../db/misc.js';
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

function pctLabel(valor: number): string {
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

// Same fee schedule applies to trades on the mercado secundário — the platform still
// facilitates the transfer, so the reselling investor pays the fee out of their proceeds.
export function settleResale(opts: { duplicataId: string; sacadoNome: string; buyerId: number; sellerId: number; valor: number }) {
  const fee = platformFee(opts.valor);
  const net = opts.valor - fee;
  addLedgerEntry(opts.buyerId, today(), `Compra no mercado secundário — duplicata ${opts.duplicataId} (${opts.sacadoNome})`, -opts.valor);
  addLedgerEntry(
    opts.sellerId,
    today(),
    `Venda no mercado secundário — duplicata ${opts.duplicataId}, taxa de plataforma ${pctLabel(opts.valor)} descontada (${fmtBRL(fee)})`,
    net
  );
  return { fee, net };
}
