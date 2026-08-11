import { db } from './index.js';

export interface CreditLineFundLedgerRow {
  id: number;
  tipo: 'aporte' | 'resgate' | 'saque_financiado' | 'retorno';
  valor: number;
  descricao: string;
  investor_id: number | null;
  draw_id: number | null;
  created_at: string;
}

export function addFundLedgerEntry(
  tipo: CreditLineFundLedgerRow['tipo'],
  valor: number,
  descricao: string,
  opts: { investorId?: number; drawId?: number } = {}
): CreditLineFundLedgerRow {
  const info = db
    .prepare('INSERT INTO credit_line_fund_ledger (tipo, valor, descricao, investor_id, draw_id) VALUES (?, ?, ?, ?, ?)')
    .run(tipo, valor, descricao, opts.investorId ?? null, opts.drawId ?? null);
  return db.prepare('SELECT * FROM credit_line_fund_ledger WHERE id = ?').get(info.lastInsertRowid) as CreditLineFundLedgerRow;
}

export function getFundBalance(): number {
  const row = db.prepare('SELECT COALESCE(SUM(valor), 0) as balance FROM credit_line_fund_ledger').get() as { balance: number };
  return row.balance;
}

export function listRecentFundLedger(limit = 20): CreditLineFundLedgerRow[] {
  return db.prepare('SELECT * FROM credit_line_fund_ledger ORDER BY id DESC LIMIT ?').all(limit) as CreditLineFundLedgerRow[];
}

export interface FundContributionRow {
  id: number;
  investor_id: number;
  valor_aportado: number;
  valor_resgatado: number;
  created_at: string;
}

export function addContribution(investorId: number, valor: number): FundContributionRow {
  const info = db.prepare('INSERT INTO credit_line_fund_contributions (investor_id, valor_aportado) VALUES (?, ?)').run(investorId, valor);
  return db.prepare('SELECT * FROM credit_line_fund_contributions WHERE id = ?').get(info.lastInsertRowid) as FundContributionRow;
}

export function listOpenContributionsByInvestor(investorId: number): FundContributionRow[] {
  return db
    .prepare('SELECT * FROM credit_line_fund_contributions WHERE investor_id = ? AND valor_resgatado < valor_aportado ORDER BY created_at ASC')
    .all(investorId) as FundContributionRow[];
}

export function getInvestorPosition(investorId: number): number {
  const row = db
    .prepare('SELECT COALESCE(SUM(valor_aportado - valor_resgatado), 0) as posicao FROM credit_line_fund_contributions WHERE investor_id = ?')
    .get(investorId) as { posicao: number };
  return row.posicao;
}

export function markRedeemed(contributionId: number, valor: number) {
  db.prepare('UPDATE credit_line_fund_contributions SET valor_resgatado = valor_resgatado + ? WHERE id = ?').run(valor, contributionId);
}

export interface FundQuotaMovementRow {
  id: number;
  investor_id: number;
  quotas: number;
  cota_price: number;
  created_at: string;
}

export function addQuotaMovement(investorId: number, quotas: number, cotaPrice: number): FundQuotaMovementRow {
  const info = db
    .prepare('INSERT INTO credit_line_fund_quota_movements (investor_id, quotas, cota_price) VALUES (?, ?, ?)')
    .run(investorId, quotas, cotaPrice);
  return db.prepare('SELECT * FROM credit_line_fund_quota_movements WHERE id = ?').get(info.lastInsertRowid) as FundQuotaMovementRow;
}

export function getInvestorQuotas(investorId: number): number {
  const row = db
    .prepare('SELECT COALESCE(SUM(quotas), 0) as total FROM credit_line_fund_quota_movements WHERE investor_id = ?')
    .get(investorId) as { total: number };
  return row.total;
}

export function getTotalQuotas(): number {
  const row = db.prepare('SELECT COALESCE(SUM(quotas), 0) as total FROM credit_line_fund_quota_movements').get() as { total: number };
  return row.total;
}
