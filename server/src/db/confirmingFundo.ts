import { db } from './index.js';

export interface ConfirmingFundoLedgerRow {
  id: number;
  tipo: 'aporte' | 'resgate' | 'compra_financiada' | 'retorno';
  valor: number;
  descricao: string;
  investor_id: number | null;
  duplicata_id: string | null;
  created_at: string;
}

export function addFundoLedgerEntry(
  tipo: ConfirmingFundoLedgerRow['tipo'],
  valor: number,
  descricao: string,
  opts: { investorId?: number; duplicataId?: string } = {}
): ConfirmingFundoLedgerRow {
  const info = db
    .prepare('INSERT INTO confirming_fundo_ledger (tipo, valor, descricao, investor_id, duplicata_id) VALUES (?, ?, ?, ?, ?)')
    .run(tipo, valor, descricao, opts.investorId ?? null, opts.duplicataId ?? null);
  return db.prepare('SELECT * FROM confirming_fundo_ledger WHERE id = ?').get(info.lastInsertRowid) as ConfirmingFundoLedgerRow;
}

export function getFundoBalance(): number {
  const row = db.prepare('SELECT COALESCE(SUM(valor), 0) as balance FROM confirming_fundo_ledger').get() as { balance: number };
  return row.balance;
}

export function listRecentFundoLedger(limit = 20): ConfirmingFundoLedgerRow[] {
  return db.prepare('SELECT * FROM confirming_fundo_ledger ORDER BY id DESC LIMIT ?').all(limit) as ConfirmingFundoLedgerRow[];
}

export interface FundoContributionRow {
  id: number;
  investor_id: number;
  valor_aportado: number;
  valor_resgatado: number;
  created_at: string;
}

export function addFundoContribution(investorId: number, valor: number): FundoContributionRow {
  const info = db.prepare('INSERT INTO confirming_fundo_contributions (investor_id, valor_aportado) VALUES (?, ?)').run(investorId, valor);
  return db.prepare('SELECT * FROM confirming_fundo_contributions WHERE id = ?').get(info.lastInsertRowid) as FundoContributionRow;
}

export function listOpenFundoContributionsByInvestor(investorId: number): FundoContributionRow[] {
  return db
    .prepare('SELECT * FROM confirming_fundo_contributions WHERE investor_id = ? AND valor_resgatado < valor_aportado ORDER BY created_at ASC')
    .all(investorId) as FundoContributionRow[];
}

export function getFundoInvestorPosition(investorId: number): number {
  const row = db
    .prepare('SELECT COALESCE(SUM(valor_aportado - valor_resgatado), 0) as posicao FROM confirming_fundo_contributions WHERE investor_id = ?')
    .get(investorId) as { posicao: number };
  return row.posicao;
}

export function markFundoRedeemed(contributionId: number, valor: number) {
  db.prepare('UPDATE confirming_fundo_contributions SET valor_resgatado = valor_resgatado + ? WHERE id = ?').run(valor, contributionId);
}

export interface FundoQuotaMovementRow {
  id: number;
  investor_id: number;
  quotas: number;
  cota_price: number;
  created_at: string;
}

export function addFundoQuotaMovement(investorId: number, quotas: number, cotaPrice: number): FundoQuotaMovementRow {
  const info = db
    .prepare('INSERT INTO confirming_fundo_quota_movements (investor_id, quotas, cota_price) VALUES (?, ?, ?)')
    .run(investorId, quotas, cotaPrice);
  return db.prepare('SELECT * FROM confirming_fundo_quota_movements WHERE id = ?').get(info.lastInsertRowid) as FundoQuotaMovementRow;
}

export function getFundoInvestorQuotas(investorId: number): number {
  const row = db
    .prepare('SELECT COALESCE(SUM(quotas), 0) as total FROM confirming_fundo_quota_movements WHERE investor_id = ?')
    .get(investorId) as { total: number };
  return row.total;
}

export function getFundoTotalQuotas(): number {
  const row = db.prepare('SELECT COALESCE(SUM(quotas), 0) as total FROM confirming_fundo_quota_movements').get() as { total: number };
  return row.total;
}
