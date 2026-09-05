import { db } from './index.js';
import type { AuctionBidRow, AuctionBidStatus } from './types.js';

// Espelha db/resaleBids.ts, que já é a mecânica de lance real do mercado secundário.

export function createAuctionBid(duplicataId: string, bidderId: number, taxaAm: number, preco: number): AuctionBidRow {
  const info = db
    .prepare('INSERT INTO auction_bids (duplicata_id, bidder_id, taxa_am, preco) VALUES (?, ?, ?, ?)')
    .run(duplicataId, bidderId, taxaAm, preco);
  return getAuctionBid(Number(info.lastInsertRowid))!;
}

export function getAuctionBid(id: number): AuctionBidRow | undefined {
  return db.prepare('SELECT * FROM auction_bids WHERE id = ?').get(id) as AuctionBidRow | undefined;
}

// Um investidor tem no máximo um lance ativo por duplicata: lançar de novo substitui o
// anterior (ver placeAuctionBid em lib/auctionCore.ts), como no secundário.
export function getActiveAuctionBid(duplicataId: string, bidderId: number): AuctionBidRow | undefined {
  return db
    .prepare("SELECT * FROM auction_bids WHERE duplicata_id = ? AND bidder_id = ? AND status = 'ativo'")
    .get(duplicataId, bidderId) as AuctionBidRow | undefined;
}

export function setAuctionBidStatus(id: number, status: AuctionBidStatus) {
  db.prepare('UPDATE auction_bids SET status = ? WHERE id = ?').run(status, id);
}

// Ordenado pelo critério de vitória: menor deságio primeiro; empate desempata por quem
// lançou antes (created_at, depois id), a regra de leilão mais comum e a única que não
// depende de nada fora da mesa.
export function listActiveAuctionBids(duplicataId: string): (AuctionBidRow & { bidder_company_name: string })[] {
  return db
    .prepare(
      `SELECT b.*, u.company_name as bidder_company_name FROM auction_bids b
       JOIN users u ON u.id = b.bidder_id
       WHERE b.duplicata_id = ? AND b.status = 'ativo'
       ORDER BY b.taxa_am ASC, b.created_at ASC, b.id ASC`
    )
    .all(duplicataId) as (AuctionBidRow & { bidder_company_name: string })[];
}

export function listMyAuctionBids(bidderId: number): (AuctionBidRow & { sacado_nome: string; valor: number; close_at: string | null })[] {
  return db
    .prepare(
      `SELECT b.*, d.sacado_nome as sacado_nome, d.valor as valor, d.close_at as close_at FROM auction_bids b
       JOIN duplicatas d ON d.id = b.duplicata_id
       WHERE b.bidder_id = ? ORDER BY b.created_at DESC`
    )
    .all(bidderId) as (AuctionBidRow & { sacado_nome: string; valor: number; close_at: string | null })[];
}

// Melhor (menor) taxa ativa por duplicata — para a listagem do marketplace mostrar em que
// pé está cada leilão sem uma consulta por linha.
export function bestActiveBidByDuplicata(): Map<string, { taxa_am: number; total: number }> {
  const rows = db
    .prepare(
      `SELECT duplicata_id, MIN(taxa_am) as taxa_am, COUNT(*) as total FROM auction_bids
       WHERE status = 'ativo' GROUP BY duplicata_id`
    )
    .all() as { duplicata_id: string; taxa_am: number; total: number }[];
  return new Map(rows.map((r) => [r.duplicata_id, { taxa_am: r.taxa_am, total: r.total }]));
}

// Leilões vencidos que ainda não foram adjudicados — a fila do job de fechamento.
export function listAuctionsToClose(nowIso: string, apenasDuplicataId?: string): { id: string }[] {
  const base = `SELECT id FROM duplicatas
       WHERE status = 'no_mercado' AND sandbox = 0 AND close_at IS NOT NULL
         AND close_at <= ? AND leilao_fechado_em IS NULL`;
  // O filtro por id existe pro fechamento pontual (um leilão específico venceu) não arrastar
  // junto todo leilão vencido do banco — é o que os testes usam pra não encerrar as outras
  // ofertas do marketplace de carona.
  if (apenasDuplicataId) return db.prepare(`${base} AND id = ?`).all(nowIso, apenasDuplicataId) as { id: string }[];
  return db.prepare(base).all(nowIso) as { id: string }[];
}

export function markAuctionClosed(duplicataId: string, whenIso: string) {
  db.prepare('UPDATE duplicatas SET leilao_fechado_em = ? WHERE id = ?').run(whenIso, duplicataId);
}
