import { db } from './index.js';

export interface LegalCollectionFeeRow {
  id: number;
  duplicata_id: string;
  recovered_valor: number;
  fee_pct: number;
  fee_valor: number;
  charged_user_id: number | null;
  charged_role: 'cedente' | 'investidor';
  recorded_by: number | null;
  created_at: string;
}

export function recordLegalCollectionFee(opts: {
  duplicataId: string;
  recoveredValor: number;
  feePct: number;
  feeValor: number;
  chargedUserId: number | null;
  chargedRole: 'cedente' | 'investidor';
  recordedBy?: number;
}): LegalCollectionFeeRow {
  const info = db
    .prepare(
      `INSERT INTO legal_collection_fees (duplicata_id, recovered_valor, fee_pct, fee_valor, charged_user_id, charged_role, recorded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(opts.duplicataId, opts.recoveredValor, opts.feePct, opts.feeValor, opts.chargedUserId, opts.chargedRole, opts.recordedBy ?? null);
  return db.prepare('SELECT * FROM legal_collection_fees WHERE id = ?').get(Number(info.lastInsertRowid)) as LegalCollectionFeeRow;
}

export function hasFeeAlreadyCharged(duplicataId: string): boolean {
  const row = db.prepare('SELECT COUNT(*) as n FROM legal_collection_fees WHERE duplicata_id = ?').get(duplicataId) as { n: number };
  return row.n > 0;
}

export function listLegalCollectionFeesByDuplicata(duplicataId: string): LegalCollectionFeeRow[] {
  return db.prepare('SELECT * FROM legal_collection_fees WHERE duplicata_id = ? ORDER BY created_at DESC').all(duplicataId) as LegalCollectionFeeRow[];
}

export function sumLegalCollectionFees(): { totalFeeValor: number; totalRecoveredValor: number; count: number } {
  const row = db
    .prepare('SELECT COALESCE(SUM(fee_valor), 0) as totalFeeValor, COALESCE(SUM(recovered_valor), 0) as totalRecoveredValor, COUNT(*) as count FROM legal_collection_fees')
    .get() as { totalFeeValor: number; totalRecoveredValor: number; count: number };
  return row;
}

export function listAllLegalCollectionFees(limit = 50): (LegalCollectionFeeRow & { sacado_nome: string; cedente_nome: string })[] {
  return db
    .prepare(
      `SELECT lcf.*, d.sacado_nome as sacado_nome, d.cedente_nome as cedente_nome
       FROM legal_collection_fees lcf
       JOIN duplicatas d ON d.id = lcf.duplicata_id
       ORDER BY lcf.created_at DESC LIMIT ?`
    )
    .all(limit) as (LegalCollectionFeeRow & { sacado_nome: string; cedente_nome: string })[];
}
