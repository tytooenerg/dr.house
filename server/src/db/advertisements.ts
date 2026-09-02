import { db } from './index.js';

export interface AdvertisementRow {
  id: number;
  advertiser_id: number;
  logo_url: string;
  titulo: string;
  texto: string;
  link_url: string;
  status: 'pendente' | 'aprovado' | 'rejeitado';
  ativo: number;
  reject_reason: string | null;
  created_at: string;
  updated_at: string;
}

export function getAdvertisementByAdvertiser(advertiserId: number): AdvertisementRow | undefined {
  return db.prepare('SELECT * FROM advertisements WHERE advertiser_id = ?').get(advertiserId) as AdvertisementRow | undefined;
}

export function getAdvertisement(id: number): AdvertisementRow | undefined {
  return db.prepare('SELECT * FROM advertisements WHERE id = ?').get(id) as AdvertisementRow | undefined;
}

// One anúncio per advertiser (UNIQUE(advertiser_id)) — creates the first one as 'pendente',
// or updates the existing one. An edit after a rejection (or any edit at all — the content
// an admin already reviewed no longer matches what would run) always goes back to
// 'pendente': the admin needs to look at the new content, not the old one.
export function upsertAdvertisement(advertiserId: number, input: { logoUrl: string; titulo: string; texto: string; linkUrl: string }): AdvertisementRow {
  const existing = getAdvertisementByAdvertiser(advertiserId);
  if (existing) {
    db.prepare(
      `UPDATE advertisements SET logo_url = ?, titulo = ?, texto = ?, link_url = ?, status = 'pendente', reject_reason = NULL, updated_at = datetime('now')
       WHERE advertiser_id = ?`
    ).run(input.logoUrl, input.titulo, input.texto, input.linkUrl, advertiserId);
  } else {
    db.prepare('INSERT INTO advertisements (advertiser_id, logo_url, titulo, texto, link_url) VALUES (?, ?, ?, ?, ?)').run(
      advertiserId,
      input.logoUrl,
      input.titulo,
      input.texto,
      input.linkUrl
    );
  }
  return getAdvertisementByAdvertiser(advertiserId)!;
}

// The advertiser's own on/off switch — only actually shows up in the carousel while also
// status='aprovado' (see listActiveApprovedAdvertisements), but can be toggled off anytime
// (e.g. pausing without losing the approved content), and the monthly charge
// (lib/advertisementBilling.ts) only fires while both are true.
export function setAdvertisementAtivo(advertiserId: number, ativo: boolean): AdvertisementRow | undefined {
  db.prepare("UPDATE advertisements SET ativo = ?, updated_at = datetime('now') WHERE advertiser_id = ?").run(ativo ? 1 : 0, advertiserId);
  return getAdvertisementByAdvertiser(advertiserId);
}

export function listPendingAdvertisements(): (AdvertisementRow & { company_name: string })[] {
  return db
    .prepare(
      `SELECT a.*, u.company_name as company_name FROM advertisements a
       JOIN users u ON u.id = a.advertiser_id
       WHERE a.status = 'pendente' ORDER BY a.created_at ASC`
    )
    .all() as (AdvertisementRow & { company_name: string })[];
}

export function decideAdvertisement(id: number, decision: 'aprovado' | 'rejeitado', rejectReason: string | null): void {
  db.prepare("UPDATE advertisements SET status = ?, reject_reason = ?, updated_at = datetime('now') WHERE id = ?").run(decision, rejectReason, id);
}

// Fully public read (routes/public.ts) — every field a landing-page visitor actually sees.
export function listActiveApprovedAdvertisements(): { id: number; logoUrl: string; titulo: string; texto: string; linkUrl: string }[] {
  return (
    db.prepare("SELECT id, logo_url, titulo, texto, link_url FROM advertisements WHERE status = 'aprovado' AND ativo = 1 ORDER BY updated_at ASC").all() as {
      id: number;
      logo_url: string;
      titulo: string;
      texto: string;
      link_url: string;
    }[]
  ).map((r) => ({ id: r.id, logoUrl: r.logo_url, titulo: r.titulo, texto: r.texto, linkUrl: r.link_url }));
}

// Advertisers actually billable this period (lib/advertisementBilling.ts) — approved AND
// currently active. A paused (ativo=0) or still-pending/rejected ad is never charged.
export function listActiveApprovedAdvertiserIds(): number[] {
  return (db.prepare("SELECT advertiser_id FROM advertisements WHERE status = 'aprovado' AND ativo = 1").all() as { advertiser_id: number }[]).map(
    (r) => r.advertiser_id
  );
}
