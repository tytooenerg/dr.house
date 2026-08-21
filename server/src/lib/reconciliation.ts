import { db } from '../db/index.js';
import { raiseFlag, listFlags, getFlag, resolveFlag as resolveFlagRow } from '../db/reconciliation.js';
import { fmtBRL } from './format.js';

// Reconciliation Agent's core check: every payment rail this platform has (Pix, boleto,
// TED) confirms money moved by flipping a status + timestamp on its own table
// (db/pix.ts, db/boletos.ts, db/ted.ts); separately, lib/account.ts-style routes write a
// ledger row so the user sees it in their extrato. Those two writes aren't one transaction
// today, so it's a real (if rare) failure mode for one to happen without the other. This
// scans for exactly that gap — a confirmed rail event with no matching ledger entry — and
// raises a reviewable flag rather than silently trusting that both always happen together.
const MATCH_WINDOW_MINUTES = 10;

interface RailEvent {
  tipo: 'pix' | 'boleto' | 'ted';
  referencia: string;
  userId: number;
  valor: number;
  confirmedAt: string;
}

function fetchConfirmedPix(sinceIso: string): RailEvent[] {
  return (
    db
      .prepare("SELECT txid, user_id, valor, concluded_at FROM pix_charges WHERE status = 'concluida' AND concluded_at >= ? AND simulado = 0")
      .all(sinceIso) as { txid: string; user_id: number; valor: number; concluded_at: string }[]
  ).map((r) => ({ tipo: 'pix', referencia: r.txid, userId: r.user_id, valor: r.valor, confirmedAt: r.concluded_at }));
}

function fetchConfirmedBoletos(sinceIso: string): RailEvent[] {
  return (
    db
      .prepare("SELECT nosso_numero, user_id, valor, paid_at FROM boletos WHERE status = 'pago' AND paid_at >= ? AND simulado = 0")
      .all(sinceIso) as { nosso_numero: string; user_id: number; valor: number; paid_at: string }[]
  ).map((r) => ({ tipo: 'boleto', referencia: r.nosso_numero, userId: r.user_id, valor: r.valor, confirmedAt: r.paid_at }));
}

function fetchConfirmedTed(sinceIso: string): RailEvent[] {
  return (
    db
      .prepare("SELECT referencia, user_id, valor, confirmed_at FROM ted_deposits WHERE status = 'recebido' AND confirmed_at >= ? AND simulado = 0")
      .all(sinceIso) as { referencia: string; user_id: number; valor: number; confirmed_at: string }[]
  ).map((r) => ({ tipo: 'ted', referencia: r.referencia, userId: r.user_id, valor: r.valor, confirmedAt: r.confirmed_at }));
}

function hasMatchingLedgerEntry(userId: number, valor: number, confirmedAt: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 FROM ledger WHERE user_id = ? AND valor = ?
       AND created_at BETWEEN datetime(?, '-${MATCH_WINDOW_MINUTES} minutes') AND datetime(?, '+${MATCH_WINDOW_MINUTES} minutes')
       LIMIT 1`
    )
    .get(userId, valor, confirmedAt, confirmedAt);
  return !!row;
}

export interface ReconciliationRunResult {
  checked: number;
  matched: number;
  newlyFlagged: number;
}

// Only real (non-simulado) rail events are checked — a "Confirmar (simulado)" click in dev
// never has a real bank confirmation behind it, so there's nothing meaningful to reconcile
// against there; see lib/paymentRail.ts's own real/simulated split for the same distinction.
export function runReconciliation(lookbackDays = 7): ReconciliationRunResult {
  const since = new Date(Date.now() - lookbackDays * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  const events = [...fetchConfirmedPix(since), ...fetchConfirmedBoletos(since), ...fetchConfirmedTed(since)];

  let matched = 0;
  let newlyFlagged = 0;
  for (const e of events) {
    if (hasMatchingLedgerEntry(e.userId, e.valor, e.confirmedAt)) {
      matched++;
      continue;
    }
    const tipoLabel = e.tipo === 'pix' ? 'Pix' : e.tipo === 'boleto' ? 'boleto' : 'TED';
    const raised = raiseFlag({
      tipo: e.tipo,
      referencia: e.referencia,
      userId: e.userId,
      valor: e.valor,
      descricao: `Pagamento via ${tipoLabel} confirmado (${fmtBRL(e.valor)}) sem lançamento correspondente no extrato — referência ${e.referencia}.`,
    });
    if (raised) newlyFlagged++;
  }
  return { checked: events.length, matched, newlyFlagged };
}

export function listOpenFlags() {
  return listFlags('aberta');
}

export function listAllFlags() {
  return listFlags();
}

export type ResolveFlagOutcome =
  | { status: 200; body: { ok: true } }
  | { status: 404; body: { error: 'not_found'; message: string } };

export function resolveFlag(id: number, adminId: number): ResolveFlagOutcome {
  const row = getFlag(id);
  if (!row) return { status: 404, body: { error: 'not_found', message: 'Alerta de reconciliação não encontrado.' } };
  resolveFlagRow(id, adminId);
  return { status: 200, body: { ok: true } };
}
