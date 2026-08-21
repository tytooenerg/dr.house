import { db } from './index.js';
import type { ResaleBidRow, ResaleBidStatus } from './types.js';

export function createBid(listingId: number, bidderId: number, valor: number): ResaleBidRow {
  const info = db.prepare('INSERT INTO resale_bids (listing_id, bidder_id, valor) VALUES (?, ?, ?)').run(listingId, bidderId, valor);
  return getBid(Number(info.lastInsertRowid))!;
}

export function getBid(id: number): ResaleBidRow | undefined {
  return db.prepare('SELECT * FROM resale_bids WHERE id = ?').get(id) as ResaleBidRow | undefined;
}

// A bidder can hold at most one active bid per listing — raising a bid replaces the old one
// rather than stacking a second row, so "my current offer on this listing" is unambiguous.
export function getActiveBidByBidder(listingId: number, bidderId: number): ResaleBidRow | undefined {
  return db.prepare("SELECT * FROM resale_bids WHERE listing_id = ? AND bidder_id = ? AND status = 'ativo'").get(listingId, bidderId) as ResaleBidRow | undefined;
}

export function setBidStatus(id: number, status: ResaleBidStatus) {
  db.prepare('UPDATE resale_bids SET status = ? WHERE id = ?').run(status, id);
}

// Called once a listing is sold (bid accepted, or the listing bought outright at asking) —
// every other still-open bid on it is now moot and shouldn't linger as "ativo".
export function supersedeOtherActiveBids(listingId: number, exceptBidId: number | null) {
  db.prepare("UPDATE resale_bids SET status = 'superado' WHERE listing_id = ? AND status = 'ativo' AND id != ?").run(listingId, exceptBidId ?? -1);
}

export function listActiveBidsForListing(listingId: number): (ResaleBidRow & { bidder_company_name: string })[] {
  return db
    .prepare(
      `SELECT rb.*, u.company_name as bidder_company_name FROM resale_bids rb
       JOIN users u ON u.id = rb.bidder_id
       WHERE rb.listing_id = ? AND rb.status = 'ativo'
       ORDER BY rb.valor DESC, rb.created_at ASC`
    )
    .all(listingId) as (ResaleBidRow & { bidder_company_name: string })[];
}

// The single best (highest) active bid per listing, across every currently-active listing —
// powers the "profundidade" column the whole market view shows (best bid vs. asking price),
// without exposing bidder identity to anyone but the seller.
export function bestActiveBidsByListing(): Map<number, number> {
  const rows = db
    .prepare(`SELECT listing_id, MAX(valor) as best FROM resale_bids WHERE status = 'ativo' GROUP BY listing_id`)
    .all() as { listing_id: number; best: number }[];
  return new Map(rows.map((r) => [r.listing_id, r.best]));
}

export function listMyBids(bidderId: number): (ResaleBidRow & { duplicata_id: string; asking_valor: number; listing_status: string })[] {
  return db
    .prepare(
      `SELECT rb.*, rl.duplicata_id as duplicata_id, rl.asking_valor as asking_valor, rl.status as listing_status
       FROM resale_bids rb
       JOIN resale_listings rl ON rl.id = rb.listing_id
       WHERE rb.bidder_id = ?
       ORDER BY rb.created_at DESC
       LIMIT 50`
    )
    .all(bidderId) as (ResaleBidRow & { duplicata_id: string; asking_valor: number; listing_status: string })[];
}
