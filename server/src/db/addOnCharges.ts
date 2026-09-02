import { db } from './index.js';

export type AddOnKind =
  | 'api_overage'
  | 'score_api'
  | 'pld_screening_api'
  | 'registro_api'
  | 'whitelabel_plus'
  | 'institutional_reporting'
  | 'judicial_records_api'
  | 'fraud_screening_api'
  | 'document_intelligence_api'
  | 'reconciliation_api'
  | 'suitability_api'
  | 'market_index_api'
  | 'publicidade_carrossel';

export interface AddOnChargeRow {
  id: number;
  user_id: number;
  kind: AddOnKind;
  period: string | null;
  quantity: number;
  unit_price: number;
  amount: number;
  description: string;
  created_at: string;
}

export function recordAddOnCharge(input: {
  userId: number;
  kind: AddOnKind;
  period?: string | null;
  quantity: number;
  unitPrice: number;
  amount: number;
  description: string;
}): AddOnChargeRow {
  const info = db
    .prepare('INSERT INTO addon_charges (user_id, kind, period, quantity, unit_price, amount, description) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(input.userId, input.kind, input.period ?? null, input.quantity, input.unitPrice, input.amount, input.description);
  return db.prepare('SELECT * FROM addon_charges WHERE id = ?').get(Number(info.lastInsertRowid)) as AddOnChargeRow;
}

// Recurring/monthly kinds only ever charge once per user per period — the caller checks
// this before charging (see lib/addOnBilling.ts) rather than relying solely on the DB
// UNIQUE constraint, so it can skip cleanly instead of throwing.
export function hasChargedThisPeriod(userId: number, kind: AddOnKind, period: string): boolean {
  const row = db.prepare('SELECT COUNT(*) as n FROM addon_charges WHERE user_id = ? AND kind = ? AND period = ?').get(userId, kind, period) as {
    n: number;
  };
  return row.n > 0;
}

export function sumAddOnChargesByKind(kind: AddOnKind): { total: number; count: number } {
  const row = db.prepare('SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count FROM addon_charges WHERE kind = ?').get(kind) as {
    total: number;
    count: number;
  };
  return row;
}

export function listAddOnChargesByUser(userId: number, limit = 50): AddOnChargeRow[] {
  return db.prepare('SELECT * FROM addon_charges WHERE user_id = ? ORDER BY created_at DESC LIMIT ?').all(userId, limit) as AddOnChargeRow[];
}

export function listRecentAddOnCharges(limit = 100): (AddOnChargeRow & { company_name: string })[] {
  return db
    .prepare(
      `SELECT a.*, u.company_name as company_name FROM addon_charges a
       JOIN users u ON u.id = a.user_id ORDER BY a.created_at DESC LIMIT ?`
    )
    .all(limit) as (AddOnChargeRow & { company_name: string })[];
}
