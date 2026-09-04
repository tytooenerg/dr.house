import { db } from './index.js';
import type { PlatformFeeEventRow } from './types.js';

// `valor` is the base amount the fee was computed on (opts.valor in settlePurchase/
// settleResale — face value for a primary purchase, the agreed resale price for a
// resale) — kept alongside fee_valor so mediaEfetivaPct can be reconstructed exactly,
// since platformFeePct is tiered (not a flat rate you could invert from fee_valor alone).
export function recordPlatformFeeEvent(duplicataId: string, valor: number, feeValor: number, origem: 'compra' | 'revenda'): PlatformFeeEventRow {
  const info = db
    .prepare('INSERT INTO platform_fee_events (duplicata_id, valor, fee_valor, origem) VALUES (?, ?, ?, ?)')
    .run(duplicataId, valor, feeValor, origem);
  return db.prepare('SELECT * FROM platform_fee_events WHERE id = ?').get(Number(info.lastInsertRowid)) as PlatformFeeEventRow;
}

export function sumPlatformFeeEvents(): { totalFees: number; totalVolume: number; totalEventos: number } {
  const row = db
    .prepare('SELECT COUNT(*) as n, COALESCE(SUM(fee_valor), 0) as fees, COALESCE(SUM(valor), 0) as volume FROM platform_fee_events')
    .get() as { n: number; fees: number; volume: number };
  return { totalFees: row.fees, totalVolume: row.volume, totalEventos: row.n };
}
