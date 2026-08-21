import { db } from './index.js';

export interface GuaranteeFundLedgerRow {
  id: number;
  tipo: 'contribuicao' | 'sinistro_pago' | 'ajuste_admin';
  valor: number;
  descricao: string;
  duplicata_id: string | null;
  created_at: string;
}

export function addFundLedgerEntry(tipo: GuaranteeFundLedgerRow['tipo'], valor: number, descricao: string, duplicataId?: string): GuaranteeFundLedgerRow {
  const info = db
    .prepare('INSERT INTO guarantee_fund_ledger (tipo, valor, descricao, duplicata_id) VALUES (?, ?, ?, ?)')
    .run(tipo, valor, descricao, duplicataId ?? null);
  return db.prepare('SELECT * FROM guarantee_fund_ledger WHERE id = ?').get(info.lastInsertRowid) as GuaranteeFundLedgerRow;
}

export function getFundBalance(): number {
  const row = db.prepare('SELECT COALESCE(SUM(valor), 0) as balance FROM guarantee_fund_ledger').get() as { balance: number };
  return row.balance;
}

export function listRecentFundLedger(limit = 20): GuaranteeFundLedgerRow[] {
  return db.prepare('SELECT * FROM guarantee_fund_ledger ORDER BY id DESC LIMIT ?').all(limit) as GuaranteeFundLedgerRow[];
}

export interface GuaranteeFundClaimRow {
  id: number;
  duplicata_id: string;
  investor_id: number;
  valor_solicitado: number;
  valor_pago: number | null;
  status: 'aberto' | 'aprovado' | 'negado';
  note: string | null;
  decided_by: number | null;
  decided_at: string | null;
  created_at: string;
}

export function createFundClaim(duplicataId: string, investorId: number, valorSolicitado: number): GuaranteeFundClaimRow {
  const info = db
    .prepare('INSERT INTO guarantee_fund_claims (duplicata_id, investor_id, valor_solicitado) VALUES (?, ?, ?)')
    .run(duplicataId, investorId, valorSolicitado);
  return db.prepare('SELECT * FROM guarantee_fund_claims WHERE id = ?').get(info.lastInsertRowid) as GuaranteeFundClaimRow;
}

export function getFundClaim(id: number): GuaranteeFundClaimRow | undefined {
  return db.prepare('SELECT * FROM guarantee_fund_claims WHERE id = ?').get(id) as GuaranteeFundClaimRow | undefined;
}

export function hasOpenOrApprovedClaim(duplicataId: string): boolean {
  const row = db
    .prepare("SELECT COUNT(*) as n FROM guarantee_fund_claims WHERE duplicata_id = ? AND status IN ('aberto', 'aprovado')")
    .get(duplicataId) as { n: number };
  return row.n > 0;
}

export function listFundClaims(status?: GuaranteeFundClaimRow['status']): (GuaranteeFundClaimRow & { sacado_nome: string; investor_company_name: string })[] {
  if (status) {
    return db
      .prepare(
        `SELECT c.*, d.sacado_nome as sacado_nome, u.company_name as investor_company_name FROM guarantee_fund_claims c
         JOIN duplicatas d ON d.id = c.duplicata_id JOIN users u ON u.id = c.investor_id
         WHERE c.status = ? ORDER BY c.created_at DESC`
      )
      .all(status) as (GuaranteeFundClaimRow & { sacado_nome: string; investor_company_name: string })[];
  }
  return db
    .prepare(
      `SELECT c.*, d.sacado_nome as sacado_nome, u.company_name as investor_company_name FROM guarantee_fund_claims c
       JOIN duplicatas d ON d.id = c.duplicata_id JOIN users u ON u.id = c.investor_id
       ORDER BY c.created_at DESC`
    )
    .all() as (GuaranteeFundClaimRow & { sacado_nome: string; investor_company_name: string })[];
}

export function decideFundClaim(id: number, decision: 'aprovado' | 'negado', valorPago: number | null, decidedBy: number, note?: string) {
  db.prepare(
    "UPDATE guarantee_fund_claims SET status = ?, valor_pago = ?, decided_by = ?, decided_at = datetime('now'), note = ? WHERE id = ? AND status = 'aberto'"
  ).run(decision, valorPago, decidedBy, note ?? null, id);
}
