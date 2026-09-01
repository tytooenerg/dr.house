// Feature "Reconciliation API" — a third-party-facing generalization of
// lib/bankStatementReconciliation.ts. That module matches a real OFX bank export against
// Lastro's OWN internal `ledger` table for one specific Lastro account — a caller outside
// Lastro has no such ledger to match against. This instead takes the caller's own list of
// expected transactions directly in the request (referência, valor, data) and matches them
// against the parsed statement — same real OFX parser (lib/ofxParser.ts), same
// exact-value/date-window matching idea, generalized to arbitrary caller-supplied data
// instead of a hardcoded internal table.
import { parseOfx, type OfxTransaction } from './ofxParser.js';

const MATCH_WINDOW_DAYS = 3;

export interface ExpectedTransaction {
  referencia: string;
  valor: number;
  data: string; // 'YYYY-MM-DD'
}

export interface ReconciliationMatch {
  referencia: string;
  fitidExtrato: string;
}

export interface ReconciliationResult {
  transacoesNoExtrato: number;
  conferidas: ReconciliationMatch[];
  semCorrespondenciaNoExtrato: ExpectedTransaction[]; // expected, but no matching bank transaction found
  naoEsperadasNoExtrato: { fitid: string; valor: number; data: string; memo: string }[]; // in the statement, but not in the expected list
}

function daysBetween(a: string, b: string): number {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / (1000 * 60 * 60 * 24);
}

function ofxDateToIso(datePosted: string): string {
  return `${datePosted.slice(0, 4)}-${datePosted.slice(4, 6)}-${datePosted.slice(6, 8)}`;
}

// Throws OfxParseError (lib/ofxParser.ts) on a malformed statement — same shape the
// caller-facing route turns into a 400, mirroring every other real parser in this codebase.
export function reconcileAgainstExpected(ofxContent: string, expected: ExpectedTransaction[]): ReconciliationResult {
  const transactions = parseOfx(ofxContent);
  const usedExpected = new Set<number>();
  const usedBank = new Set<number>();
  const conferidas: ReconciliationMatch[] = [];

  transactions.forEach((t: OfxTransaction, bankIdx) => {
    const dateIso = ofxDateToIso(t.datePosted);
    const matchIdx = expected.findIndex(
      (e, i) => !usedExpected.has(i) && Math.abs(e.valor) === Math.abs(t.amount) && daysBetween(e.data, dateIso) <= MATCH_WINDOW_DAYS
    );
    if (matchIdx >= 0) {
      usedExpected.add(matchIdx);
      usedBank.add(bankIdx);
      conferidas.push({ referencia: expected[matchIdx].referencia, fitidExtrato: t.fitid });
    }
  });

  const semCorrespondenciaNoExtrato = expected.filter((_, i) => !usedExpected.has(i));
  const naoEsperadasNoExtrato = transactions
    .filter((_, i) => !usedBank.has(i))
    .map((t) => ({ fitid: t.fitid, valor: t.amount, data: ofxDateToIso(t.datePosted), memo: t.memo }));

  return { transacoesNoExtrato: transactions.length, conferidas, semCorrespondenciaNoExtrato, naoEsperadasNoExtrato };
}
