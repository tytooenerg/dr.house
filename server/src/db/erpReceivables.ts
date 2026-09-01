import { db } from './index.js';

export type ErpFonte = 'omie' | 'sap' | 'totvs';

export interface ErpReceivableRow {
  id: number;
  cedente_id: number;
  fonte: ErpFonte;
  external_id: string;
  cliente: string;
  valor: number;
  vencimento: string;
  fetched_at: string;
}

const upsertStmt = db.prepare(
  `INSERT INTO erp_receivables (cedente_id, fonte, external_id, cliente, valor, vencimento, fetched_at)
   VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
   ON CONFLICT(cedente_id, fonte, external_id) DO UPDATE SET
     cliente = excluded.cliente, valor = excluded.valor, vencimento = excluded.vencimento, fetched_at = excluded.fetched_at`
);

// Snapshots whatever the ERP returned as still-open on this fetch. Deliberately does NOT
// delete rows missing from the current batch — a conta that stopped appearing might mean
// "received" or might mean "this fetch only returned the first page" (every connector caps
// at 50 rows), and guessing which would be worse than a slightly stale row aging out
// naturally as its vencimento passes and lib/cashflowForecast.ts stops counting it.
export function upsertErpReceivables(cedenteId: number, fonte: ErpFonte, contas: { externalId: string; cliente: string; valor: number; vencimento: string }[]): void {
  const tx = db.transaction((rows: typeof contas) => {
    for (const c of rows) upsertStmt.run(cedenteId, fonte, c.externalId, c.cliente, c.valor, c.vencimento);
  });
  tx(contas);
}

export function listErpReceivablesByCedente(cedenteId: number): ErpReceivableRow[] {
  return db.prepare('SELECT * FROM erp_receivables WHERE cedente_id = ? ORDER BY vencimento ASC').all(cedenteId) as ErpReceivableRow[];
}
