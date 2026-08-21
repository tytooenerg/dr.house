import { db } from './index.js';

export interface PixChargeRow {
  txid: string;
  user_id: number;
  valor: number;
  status: 'ativa' | 'concluida' | 'expirada';
  simulado: number;
  end_to_end_id: string | null;
  brcode: string | null;
  created_at: string;
  concluded_at: string | null;
}

export function createPixCharge(opts: { txid: string; userId: number; valor: number; simulado: boolean; brcode: string | null }) {
  db.prepare('INSERT INTO pix_charges (txid, user_id, valor, simulado, brcode) VALUES (?, ?, ?, ?, ?)').run(
    opts.txid,
    opts.userId,
    opts.valor,
    opts.simulado ? 1 : 0,
    opts.brcode
  );
}

export function getPixCharge(txid: string): PixChargeRow | undefined {
  return db.prepare('SELECT * FROM pix_charges WHERE txid = ?').get(txid) as PixChargeRow | undefined;
}

export function concludePixCharge(txid: string, endToEndId: string | null) {
  db.prepare("UPDATE pix_charges SET status = 'concluida', end_to_end_id = ?, concluded_at = datetime('now') WHERE txid = ? AND status = 'ativa'").run(
    endToEndId,
    txid
  );
}

export function listPixChargesByUser(userId: number): PixChargeRow[] {
  return db.prepare('SELECT * FROM pix_charges WHERE user_id = ? ORDER BY created_at DESC').all(userId) as PixChargeRow[];
}

export interface PixPayoutRow {
  id: number;
  user_id: number;
  valor: number;
  chave_destino: string;
  status: 'concluido' | 'falhou';
  simulado: number;
  end_to_end_id: string | null;
  created_at: string;
}

export function recordPixPayout(opts: { userId: number; valor: number; chaveDestino: string; simulado: boolean; endToEndId: string | null }) {
  db.prepare('INSERT INTO pix_payouts (user_id, valor, chave_destino, simulado, end_to_end_id) VALUES (?, ?, ?, ?, ?)').run(
    opts.userId,
    opts.valor,
    opts.chaveDestino,
    opts.simulado ? 1 : 0,
    opts.endToEndId
  );
}
