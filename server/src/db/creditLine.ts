import { db } from './index.js';

export interface CreditLineRow {
  id: number;
  cedente_id: number;
  limite: number;
  utilizado: number;
  taxa_am: number;
  status: 'ativa' | 'suspensa';
  created_at: string;
  updated_at: string;
}

export interface CreditLineDrawRow {
  id: number;
  credit_line_id: number;
  valor_original: number;
  saldo_devedor: number;
  taxa_am: number;
  status: 'aberto' | 'quitado';
  created_at: string;
  quitado_at: string | null;
  last_accrual_at: string;
}

export function getCreditLineByCedente(cedenteId: number): CreditLineRow | undefined {
  return db.prepare('SELECT * FROM credit_lines WHERE cedente_id = ?').get(cedenteId) as CreditLineRow | undefined;
}

export function upsertCreditLine(cedenteId: number, limite: number, taxaAm: number): CreditLineRow {
  const existing = getCreditLineByCedente(cedenteId);
  if (existing) {
    db.prepare('UPDATE credit_lines SET limite = ?, taxa_am = ?, updated_at = datetime(\'now\') WHERE id = ?').run(limite, taxaAm, existing.id);
  } else {
    db.prepare('INSERT INTO credit_lines (cedente_id, limite, taxa_am) VALUES (?, ?, ?)').run(cedenteId, limite, taxaAm);
  }
  return getCreditLineByCedente(cedenteId)!;
}

export function setCreditLineUtilizado(lineId: number, utilizado: number) {
  db.prepare('UPDATE credit_lines SET utilizado = ?, updated_at = datetime(\'now\') WHERE id = ?').run(Math.max(0, utilizado), lineId);
}

export function createDraw(lineId: number, valor: number, taxaAm: number): CreditLineDrawRow {
  const info = db
    .prepare('INSERT INTO credit_line_draws (credit_line_id, valor_original, saldo_devedor, taxa_am) VALUES (?, ?, ?, ?)')
    .run(lineId, valor, valor, taxaAm);
  return db.prepare('SELECT * FROM credit_line_draws WHERE id = ?').get(info.lastInsertRowid) as CreditLineDrawRow;
}

export function listOpenDraws(lineId: number): CreditLineDrawRow[] {
  return db.prepare("SELECT * FROM credit_line_draws WHERE credit_line_id = ? AND status = 'aberto' ORDER BY created_at ASC").all(lineId) as CreditLineDrawRow[];
}

export function listAllDraws(lineId: number): CreditLineDrawRow[] {
  return db.prepare('SELECT * FROM credit_line_draws WHERE credit_line_id = ? ORDER BY created_at DESC').all(lineId) as CreditLineDrawRow[];
}

export function updateDrawBalance(drawId: number, saldoDevedor: number, lastAccrualAt: string) {
  db.prepare('UPDATE credit_line_draws SET saldo_devedor = ?, last_accrual_at = ? WHERE id = ?').run(saldoDevedor, lastAccrualAt, drawId);
}

export function settleDraw(drawId: number) {
  db.prepare("UPDATE credit_line_draws SET saldo_devedor = 0, status = 'quitado', quitado_at = datetime('now') WHERE id = ?").run(drawId);
}
