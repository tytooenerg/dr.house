import { db } from './index.js';
import type { BlockTradeItemRow, BlockTradeRow } from './types.js';

export function createBlockTrade(opts: { buyerId: number; criteria: unknown; quantidade: number; valorTotal: number; descontoPct: number }): BlockTradeRow {
  const info = db
    .prepare('INSERT INTO block_trades (buyer_id, criteria_json, quantidade, valor_total, desconto_pct) VALUES (?, ?, ?, ?, ?)')
    .run(opts.buyerId, JSON.stringify(opts.criteria), opts.quantidade, opts.valorTotal, opts.descontoPct);
  return getBlockTrade(Number(info.lastInsertRowid))!;
}

export function getBlockTrade(id: number): BlockTradeRow | undefined {
  return db.prepare('SELECT * FROM block_trades WHERE id = ?').get(id) as BlockTradeRow | undefined;
}

export function addBlockTradeItem(blockTradeId: number, listingId: number, duplicataId: string, sellerId: number, valor: number): BlockTradeItemRow {
  const info = db
    .prepare('INSERT INTO block_trade_items (block_trade_id, listing_id, duplicata_id, seller_id, valor) VALUES (?, ?, ?, ?, ?)')
    .run(blockTradeId, listingId, duplicataId, sellerId, valor);
  return db.prepare('SELECT * FROM block_trade_items WHERE id = ?').get(Number(info.lastInsertRowid)) as BlockTradeItemRow;
}

export function listBlockTradeItems(blockTradeId: number): BlockTradeItemRow[] {
  return db.prepare('SELECT * FROM block_trade_items WHERE block_trade_id = ?').all(blockTradeId) as BlockTradeItemRow[];
}

export function listMyBlockTrades(buyerId: number): BlockTradeRow[] {
  return db.prepare('SELECT * FROM block_trades WHERE buyer_id = ? ORDER BY created_at DESC LIMIT 20').all(buyerId) as BlockTradeRow[];
}
