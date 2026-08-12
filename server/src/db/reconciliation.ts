import { db } from './index.js';

export interface ReconciliationFlagRow {
  id: number;
  tipo: 'pix' | 'boleto' | 'ted';
  referencia: string;
  user_id: number;
  valor: number;
  descricao: string;
  status: 'aberta' | 'resolvida';
  created_at: string;
  resolved_at: string | null;
  resolved_by_admin_id: number | null;
}

// INSERT OR IGNORE: a flag is unique per (tipo, referencia), so re-running reconciliation
// over the same lookback window never duplicates an already-raised flag.
export function raiseFlag(input: { tipo: 'pix' | 'boleto' | 'ted'; referencia: string; userId: number; valor: number; descricao: string }): boolean {
  const info = db
    .prepare('INSERT OR IGNORE INTO reconciliation_flags (tipo, referencia, user_id, valor, descricao) VALUES (?, ?, ?, ?, ?)')
    .run(input.tipo, input.referencia, input.userId, input.valor, input.descricao);
  return info.changes > 0;
}

export function listFlags(status?: 'aberta' | 'resolvida'): (ReconciliationFlagRow & { company_name: string })[] {
  if (status) {
    return db
      .prepare('SELECT f.*, u.company_name FROM reconciliation_flags f JOIN users u ON u.id = f.user_id WHERE f.status = ? ORDER BY f.created_at DESC')
      .all(status) as (ReconciliationFlagRow & { company_name: string })[];
  }
  return db
    .prepare('SELECT f.*, u.company_name FROM reconciliation_flags f JOIN users u ON u.id = f.user_id ORDER BY f.created_at DESC')
    .all() as (ReconciliationFlagRow & { company_name: string })[];
}

export function getFlag(id: number): ReconciliationFlagRow | undefined {
  return db.prepare('SELECT * FROM reconciliation_flags WHERE id = ?').get(id) as ReconciliationFlagRow | undefined;
}

export function resolveFlag(id: number, adminId: number): void {
  db.prepare("UPDATE reconciliation_flags SET status = 'resolvida', resolved_at = datetime('now'), resolved_by_admin_id = ? WHERE id = ?").run(adminId, id);
}
