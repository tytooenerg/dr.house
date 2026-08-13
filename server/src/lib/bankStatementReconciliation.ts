import { db } from '../db/index.js';
import { parseOfx, ofxDateToSqlDate, type OfxTransaction } from './ofxParser.js';
import { raiseFlag } from '../db/reconciliation.js';
import { fmtBRL } from './format.js';

// Real reconciliation against an actual bank statement — the gap called out in README's
// "AI CFO, Contas a Pagar, Reconciliation Agent..." section: lib/reconciliation.ts (the
// Reconciliation Agent) only ever compares Lastro's OWN internal payment-rail tables
// (pix_charges/boletos/ted_deposits) against Lastro's own ledger — it can never catch a
// real discrepancy against what the bank itself reports, because it never reads the bank.
// This does: an admin uploads a real OFX export from the account's actual bank, and every
// transaction in it gets checked against that account's ledger.
//
// Deliberately scoped to one direction (bank txn confirmed → no matching ledger entry),
// not the reverse (ledger entry → no matching bank txn). The reverse direction is real
// but lower-signal here — timing/fee differences between "money moved" and "bank cleared
// it" produce a lot of legitimate near-misses that would need a fuzzier matcher to not be
// noisy, and this platform doesn't have real production bank-statement volume yet to tune
// that against honestly.
const MATCH_WINDOW_DAYS = 3;

export interface BankReconciliationResult {
  transacoes: number;
  conferidas: number;
  semLancamento: number;
}

function hasMatchingLedgerEntry(userId: number, valorAbs: number, dateSql: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 FROM ledger WHERE user_id = ? AND ABS(valor) = ?
       AND created_at BETWEEN datetime(?, '-${MATCH_WINDOW_DAYS} days') AND datetime(?, '+${MATCH_WINDOW_DAYS} days')
       LIMIT 1`
    )
    .get(userId, valorAbs, dateSql, dateSql);
  return !!row;
}

function flagTransaction(userId: number, t: OfxTransaction): boolean {
  const valorAbs = Math.abs(t.amount);
  const sentido = t.amount >= 0 ? 'crédito' : 'débito';
  return raiseFlag({
    tipo: 'extrato_bancario',
    referencia: t.fitid,
    userId,
    valor: valorAbs,
    descricao: `Movimentação real do extrato bancário (${sentido}, ${fmtBRL(valorAbs)}${t.memo ? `, "${t.memo}"` : ''}) sem lançamento correspondente no extrato Lastro dentro de ${MATCH_WINDOW_DAYS} dias — FITID ${t.fitid}.`,
  });
}

// Throws OfxParseError (from lib/ofxParser.ts) on a malformed file — caller (routes) turns
// that into a 400, same shape every other real parser in this codebase uses.
export function reconcileBankStatement(userId: number, ofxText: string): BankReconciliationResult {
  const transactions = parseOfx(ofxText);
  let conferidas = 0;
  let semLancamento = 0;
  for (const t of transactions) {
    const dateSql = ofxDateToSqlDate(t.datePosted);
    if (hasMatchingLedgerEntry(userId, Math.abs(t.amount), dateSql)) {
      conferidas++;
      continue;
    }
    if (flagTransaction(userId, t)) semLancamento++;
  }
  return { transacoes: transactions.length, conferidas, semLancamento };
}
