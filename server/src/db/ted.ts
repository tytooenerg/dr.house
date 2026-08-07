import { db } from './index.js';

export interface TedDepositRow {
  referencia: string;
  user_id: number;
  valor: number;
  status: 'ativo' | 'recebido' | 'expirado';
  simulado: number;
  banco: string;
  agencia: string;
  conta: string;
  favorecido_nome: string;
  favorecido_cnpj: string;
  created_at: string;
  confirmed_at: string | null;
  confirmed_by_admin_id: number | null;
}

export function createTedDeposit(opts: {
  referencia: string;
  userId: number;
  valor: number;
  simulado: boolean;
  banco: string;
  agencia: string;
  conta: string;
  favorecidoNome: string;
  favorecidoCnpj: string;
}) {
  db.prepare(
    'INSERT INTO ted_deposits (referencia, user_id, valor, simulado, banco, agencia, conta, favorecido_nome, favorecido_cnpj) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(opts.referencia, opts.userId, opts.valor, opts.simulado ? 1 : 0, opts.banco, opts.agencia, opts.conta, opts.favorecidoNome, opts.favorecidoCnpj);
}

export function getTedDeposit(referencia: string): TedDepositRow | undefined {
  return db.prepare('SELECT * FROM ted_deposits WHERE referencia = ?').get(referencia) as TedDepositRow | undefined;
}

export function concludeTedDeposit(referencia: string, confirmedByAdminId: number | null) {
  db.prepare(
    "UPDATE ted_deposits SET status = 'recebido', confirmed_at = datetime('now'), confirmed_by_admin_id = ? WHERE referencia = ? AND status = 'ativo'"
  ).run(confirmedByAdminId, referencia);
}

export function listTedDepositsByUser(userId: number): TedDepositRow[] {
  return db.prepare('SELECT * FROM ted_deposits WHERE user_id = ? ORDER BY created_at DESC').all(userId) as TedDepositRow[];
}

// For back-office ops matching real bank statement lines to pending references.
export function listPendingTedDeposits(): (TedDepositRow & { company_name: string })[] {
  return db
    .prepare(
      `SELECT td.*, u.company_name as company_name FROM ted_deposits td
       JOIN users u ON u.id = td.user_id
       WHERE td.status = 'ativo' ORDER BY td.created_at ASC`
    )
    .all() as (TedDepositRow & { company_name: string })[];
}

export function recordTedPayout(opts: {
  userId: number;
  valor: number;
  banco: string;
  agencia: string;
  conta: string;
  favorecidoNome: string;
  favorecidoCnpj: string;
  simulado: boolean;
  protocolo: string | null;
}) {
  db.prepare(
    'INSERT INTO ted_payouts (user_id, valor, banco, agencia, conta, favorecido_nome, favorecido_cnpj, simulado, protocolo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(opts.userId, opts.valor, opts.banco, opts.agencia, opts.conta, opts.favorecidoNome, opts.favorecidoCnpj, opts.simulado ? 1 : 0, opts.protocolo);
}
