import { db } from './index.js';

export interface PayableRow {
  id: number;
  cedente_id: number;
  descricao: string;
  fornecedor: string;
  categoria: string;
  valor: number;
  vencimento: string;
  status: 'pendente' | 'pago' | 'cancelado';
  recorrente: number;
  paid_at: string | null;
  created_at: string;
}

export function listByCedente(cedenteId: number): PayableRow[] {
  return db.prepare('SELECT * FROM payables WHERE cedente_id = ? ORDER BY vencimento ASC').all(cedenteId) as PayableRow[];
}

// Every pendente payable due on/before `untilIso`, regardless of owner filter already
// applied by the caller — used by lib/cashflowForecast.ts to bucket cash-out by period.
export function listPendingByCedenteUntil(cedenteId: number, untilIso: string): PayableRow[] {
  return db
    .prepare("SELECT * FROM payables WHERE cedente_id = ? AND status = 'pendente' AND vencimento <= ? ORDER BY vencimento ASC")
    .all(cedenteId, untilIso) as PayableRow[];
}

// Feature "AI CFO — DRE simplificado (Empresarial)": expenses actually paid in a period —
// see lib/duplicatas.ts's listSettledByCedenteSince for the revenue side of the same DRE.
export function listPaidByCedenteSince(cedenteId: number, sinceIso: string): PayableRow[] {
  return db
    .prepare("SELECT * FROM payables WHERE cedente_id = ? AND status = 'pago' AND paid_at >= ? ORDER BY paid_at ASC")
    .all(cedenteId, sinceIso) as PayableRow[];
}

export function getPayable(id: number): PayableRow | undefined {
  return db.prepare('SELECT * FROM payables WHERE id = ?').get(id) as PayableRow | undefined;
}

export function createPayable(input: {
  cedenteId: number;
  descricao: string;
  fornecedor: string;
  categoria: string;
  valor: number;
  vencimento: string;
  recorrente: boolean;
}): PayableRow {
  const info = db
    .prepare(
      'INSERT INTO payables (cedente_id, descricao, fornecedor, categoria, valor, vencimento, recorrente) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .run(input.cedenteId, input.descricao, input.fornecedor, input.categoria, input.valor, input.vencimento, input.recorrente ? 1 : 0);
  return getPayable(info.lastInsertRowid as number)!;
}

export function markPayablePaid(id: number): void {
  db.prepare("UPDATE payables SET status = 'pago', paid_at = datetime('now') WHERE id = ?").run(id);
}

export function cancelPayable(id: number): void {
  db.prepare("UPDATE payables SET status = 'cancelado' WHERE id = ?").run(id);
}

export function deletePayable(id: number): void {
  db.prepare('DELETE FROM payables WHERE id = ?').run(id);
}
