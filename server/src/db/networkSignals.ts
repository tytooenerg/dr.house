import { db } from './index.js';
import { normalizeCnpj } from '../lib/format.js';
import type { NetworkSignalRow, NetworkSignalTipo } from './types.js';

export function addSignal(cnpj: string, reporterUserId: number, tipo: NetworkSignalTipo, nota?: string): NetworkSignalRow {
  const normalized = normalizeCnpj(cnpj);
  const info = db
    .prepare('INSERT INTO sacado_network_signals (cnpj, reporter_user_id, tipo, nota) VALUES (?, ?, ?, ?)')
    .run(normalized, reporterUserId, tipo, nota ?? null);
  return db.prepare('SELECT * FROM sacado_network_signals WHERE id = ?').get(Number(info.lastInsertRowid)) as NetworkSignalRow;
}

export function listSignalsForCnpj(cnpj: string, limit = 50): NetworkSignalRow[] {
  const normalized = normalizeCnpj(cnpj);
  if (!normalized) return [];
  return db
    .prepare('SELECT * FROM sacado_network_signals WHERE cnpj = ? ORDER BY created_at DESC LIMIT ?')
    .all(normalized, limit) as NetworkSignalRow[];
}

export interface SignalSummary {
  pontual: number;
  atraso: number;
  protesto: number;
  contestacao: number;
  total: number;
}

export function summarizeSignals(cnpj: string): SignalSummary {
  const normalized = normalizeCnpj(cnpj);
  const rows = normalized
    ? (db.prepare('SELECT tipo, COUNT(*) as n FROM sacado_network_signals WHERE cnpj = ? GROUP BY tipo').all(normalized) as { tipo: NetworkSignalTipo; n: number }[])
    : [];
  const summary: SignalSummary = { pontual: 0, atraso: 0, protesto: 0, contestacao: 0, total: 0 };
  for (const row of rows) {
    if (row.tipo === 'pagamento_pontual') summary.pontual = row.n;
    else if (row.tipo === 'atraso') summary.atraso = row.n;
    else if (row.tipo === 'protesto') summary.protesto = row.n;
    else if (row.tipo === 'contestacao') summary.contestacao = row.n;
    summary.total += row.n;
  }
  return summary;
}
