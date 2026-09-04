import { db } from './index.js';
import type { PurchaseRow } from './duplicatas.js';
import type { ResaleListingRow } from './types.js';

export function getActivePurchaseByDuplicata(duplicataId: string): PurchaseRow | undefined {
  return db.prepare('SELECT * FROM purchases WHERE duplicata_id = ? AND active = 1').get(duplicataId) as PurchaseRow | undefined;
}

export function getPurchaseById(id: number): PurchaseRow | undefined {
  return db.prepare('SELECT * FROM purchases WHERE id = ?').get(id) as PurchaseRow | undefined;
}

export function getListingForPurchase(purchaseId: number): ResaleListingRow | undefined {
  return db.prepare("SELECT * FROM resale_listings WHERE purchase_id = ? AND status = 'ativo'").get(purchaseId) as ResaleListingRow | undefined;
}

export function getListing(id: number): ResaleListingRow | undefined {
  return db.prepare('SELECT * FROM resale_listings WHERE id = ?').get(id) as ResaleListingRow | undefined;
}

export function createListing(purchaseId: number, duplicataId: string, sellerId: number, askingValor: number): ResaleListingRow {
  const info = db
    .prepare('INSERT INTO resale_listings (purchase_id, duplicata_id, seller_id, asking_valor) VALUES (?, ?, ?, ?)')
    .run(purchaseId, duplicataId, sellerId, askingValor);
  return getListing(Number(info.lastInsertRowid))!;
}

export function setListingStatus(id: number, status: 'vendido' | 'cancelado') {
  db.prepare('UPDATE resale_listings SET status = ? WHERE id = ?').run(status, id);
}

// `retorno` aqui precisa ser o ganho real que o vendedor efetivamente realizou ao revender
// (líquido recebido − o que ele pagou originalmente), não o valor "se tivesse segurado até
// o vencimento" que a linha já carregava desde a compra — esse número desatualizado, sem
// isso, continuaria alimentando Carteira & Histórico, o dashboard de Performance
// institucional, o relatório PDF institucional, o Informe de Rendimentos e o gerador de
// DARF como se o investidor tivesse recebido o valor de face na data do vencimento, quando
// na verdade ele saiu da posição antes disso por um valor diferente (ver
// lib/resaleCore.ts's executeResaleTrade, o único chamador real).
export function deactivatePurchase(id: number, retorno: number) {
  db.prepare('UPDATE purchases SET active = 0, retorno = ? WHERE id = ?').run(retorno, id);
}

export function listActiveListings(): (ResaleListingRow & { sacado_nome: string; cedente_nome: string; vencimento: string; score: number | null; original_valor: number })[] {
  return db
    .prepare(
      `SELECT rl.*, d.sacado_nome as sacado_nome, d.cedente_nome as cedente_nome, d.vencimento as vencimento, d.score as score, p.valor as original_valor
       FROM resale_listings rl
       JOIN duplicatas d ON d.id = rl.duplicata_id
       JOIN purchases p ON p.id = rl.purchase_id
       WHERE rl.status = 'ativo'
       ORDER BY rl.created_at DESC`
    )
    .all() as (ResaleListingRow & { sacado_nome: string; cedente_nome: string; vencimento: string; score: number | null; original_valor: number })[];
}

export function listListingsBySeller(sellerId: number): ResaleListingRow[] {
  return db.prepare('SELECT * FROM resale_listings WHERE seller_id = ? ORDER BY created_at DESC').all(sellerId) as ResaleListingRow[];
}
