import { db } from './index.js';

export type TrancheClasse = 'senior' | 'junior';

export interface GuaranteeFundTrancheLedgerRow {
  id: number;
  classe: TrancheClasse;
  tipo: 'aporte' | 'resgate' | 'rendimento' | 'perda_absorvida';
  valor: number;
  descricao: string;
  investor_id: number | null;
  created_at: string;
}

export function addTrancheLedgerEntry(
  classe: TrancheClasse,
  tipo: GuaranteeFundTrancheLedgerRow['tipo'],
  valor: number,
  descricao: string,
  investorId?: number
): GuaranteeFundTrancheLedgerRow {
  const info = db
    .prepare('INSERT INTO guarantee_fund_tranche_ledger (classe, tipo, valor, descricao, investor_id) VALUES (?, ?, ?, ?, ?)')
    .run(classe, tipo, valor, descricao, investorId ?? null);
  return db.prepare('SELECT * FROM guarantee_fund_tranche_ledger WHERE id = ?').get(info.lastInsertRowid) as GuaranteeFundTrancheLedgerRow;
}

// The NAV a class currently "owns" out of the fund's real, shared balance
// (db/guaranteeFund.ts's getFundBalance()) — attribution bookkeeping, not a second cash
// balance. See lib/guaranteeFundTranches.ts's allocateClaimLoss for how this drives the
// senior/junior loss waterfall.
export function getTrancheNav(classe: TrancheClasse): number {
  const row = db.prepare('SELECT COALESCE(SUM(valor), 0) as nav FROM guarantee_fund_tranche_ledger WHERE classe = ?').get(classe) as { nav: number };
  return row.nav;
}

export function listRecentTrancheLedger(classe: TrancheClasse, limit = 20): GuaranteeFundTrancheLedgerRow[] {
  return db
    .prepare('SELECT * FROM guarantee_fund_tranche_ledger WHERE classe = ? ORDER BY id DESC LIMIT ?')
    .all(classe, limit) as GuaranteeFundTrancheLedgerRow[];
}

export interface TrancheQuotaMovementRow {
  id: number;
  investor_id: number;
  classe: TrancheClasse;
  quotas: number;
  cota_price: number;
  created_at: string;
}

export function addTrancheQuotaMovement(investorId: number, classe: TrancheClasse, quotas: number, cotaPrice: number): TrancheQuotaMovementRow {
  const info = db
    .prepare('INSERT INTO guarantee_fund_tranche_quota_movements (investor_id, classe, quotas, cota_price) VALUES (?, ?, ?, ?)')
    .run(investorId, classe, quotas, cotaPrice);
  return db.prepare('SELECT * FROM guarantee_fund_tranche_quota_movements WHERE id = ?').get(info.lastInsertRowid) as TrancheQuotaMovementRow;
}

export function getInvestorTrancheQuotas(investorId: number, classe: TrancheClasse): number {
  const row = db
    .prepare('SELECT COALESCE(SUM(quotas), 0) as total FROM guarantee_fund_tranche_quota_movements WHERE investor_id = ? AND classe = ?')
    .get(investorId, classe) as { total: number };
  return row.total;
}

export function getTotalTrancheQuotas(classe: TrancheClasse): number {
  const row = db
    .prepare('SELECT COALESCE(SUM(quotas), 0) as total FROM guarantee_fund_tranche_quota_movements WHERE classe = ?')
    .get(classe) as { total: number };
  return row.total;
}
