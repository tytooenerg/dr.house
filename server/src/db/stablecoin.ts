import { db } from './index.js';

export interface StablecoinDepositRow {
  referencia: string;
  user_id: number;
  valor: number;
  status: 'ativo' | 'recebido' | 'expirado';
  simulado: number;
  asset: string;
  network: string;
  endereco: string;
  tx_hash: string | null;
  created_at: string;
  confirmed_at: string | null;
  confirmed_by_admin_id: number | null;
}

export function createStablecoinDeposit(opts: {
  referencia: string;
  userId: number;
  valor: number;
  simulado: boolean;
  asset: string;
  network: string;
  endereco: string;
}) {
  db.prepare(
    'INSERT INTO stablecoin_deposits (referencia, user_id, valor, simulado, asset, network, endereco) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(opts.referencia, opts.userId, opts.valor, opts.simulado ? 1 : 0, opts.asset, opts.network, opts.endereco);
}

export function getStablecoinDeposit(referencia: string): StablecoinDepositRow | undefined {
  return db.prepare('SELECT * FROM stablecoin_deposits WHERE referencia = ?').get(referencia) as StablecoinDepositRow | undefined;
}

export function concludeStablecoinDeposit(referencia: string, confirmedByAdminId: number | null, txHash: string | null) {
  db.prepare(
    "UPDATE stablecoin_deposits SET status = 'recebido', confirmed_at = datetime('now'), confirmed_by_admin_id = ?, tx_hash = COALESCE(?, tx_hash) WHERE referencia = ? AND status = 'ativo'"
  ).run(confirmedByAdminId, txHash, referencia);
}

export function listStablecoinDepositsByUser(userId: number): StablecoinDepositRow[] {
  return db.prepare('SELECT * FROM stablecoin_deposits WHERE user_id = ? ORDER BY created_at DESC').all(userId) as StablecoinDepositRow[];
}

// For back-office ops matching real on-chain transfers to pending references.
export function listPendingStablecoinDeposits(): (StablecoinDepositRow & { company_name: string })[] {
  return db
    .prepare(
      `SELECT sd.*, u.company_name as company_name FROM stablecoin_deposits sd
       JOIN users u ON u.id = sd.user_id
       WHERE sd.status = 'ativo' ORDER BY sd.created_at ASC`
    )
    .all() as (StablecoinDepositRow & { company_name: string })[];
}

export function recordStablecoinPayout(opts: {
  userId: number;
  valor: number;
  asset: string;
  network: string;
  endereco: string;
  simulado: boolean;
  txHash: string | null;
}) {
  db.prepare(
    'INSERT INTO stablecoin_payouts (user_id, valor, asset, network, endereco, simulado, tx_hash) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(opts.userId, opts.valor, opts.asset, opts.network, opts.endereco, opts.simulado ? 1 : 0, opts.txHash);
}
