// Minimal real OFX 1.x (SGML, not XML) parser — the format real Brazilian banks export
// (Itaú, Bradesco, BB, Nubank etc. all support "extrato OFX" download) for account
// statements. OFX 1.x tags are unclosed SGML (`<TRNAMT>123.45` with no `</TRNAMT>`, one
// tag per line), so a real XML parser can't read it directly — this is a small, honest
// line-scanner covering exactly the tags reconciliation needs (STMTTRN blocks), not a
// full OFX 1.x/2.x spec implementation. No external dependency: OFX 1.x's actual grammar
// is simple enough (one `<TAG>value` per line inside `<STMTTRN>...</STMTTRN>`) that a
// regex-based scanner is a faithful, honestly-scoped parser, not a shortcut pretending to
// be a general SGML engine.
export interface OfxTransaction {
  fitid: string;
  trnType: string;
  datePosted: string; // YYYYMMDD (raw OFX date, first 8 chars — no timezone math attempted)
  amount: number;
  memo: string;
}

export class OfxParseError extends Error {}

const STMTTRN_RE = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi;
const TAG_RE = /<([A-Z0-9.]+)>\s*([^\r\n<]*)/gi;

function extractTags(block: string): Record<string, string> {
  const tags: Record<string, string> = {};
  let m: RegExpExecArray | null;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(block))) {
    tags[m[1].toUpperCase()] = m[2].trim();
  }
  return tags;
}

export function parseOfx(text: string): OfxTransaction[] {
  if (!text || !text.toUpperCase().includes('<STMTTRN>')) {
    throw new OfxParseError('Arquivo não parece ser um extrato OFX válido — nenhuma transação (<STMTTRN>) encontrada.');
  }
  const transactions: OfxTransaction[] = [];
  let match: RegExpExecArray | null;
  STMTTRN_RE.lastIndex = 0;
  while ((match = STMTTRN_RE.exec(text))) {
    const tags = extractTags(match[1]);
    const amountRaw = tags.TRNAMT;
    const fitid = tags.FITID;
    const datePosted = tags.DTPOSTED;
    if (!fitid || !datePosted || amountRaw === undefined) continue; // skip a malformed block rather than fail the whole file
    const amount = Number(amountRaw.replace(',', '.'));
    if (!Number.isFinite(amount)) continue;
    transactions.push({
      fitid,
      trnType: tags.TRNTYPE ?? '',
      datePosted: datePosted.slice(0, 8),
      amount,
      memo: tags.MEMO ?? tags.NAME ?? '',
    });
  }
  if (transactions.length === 0) {
    throw new OfxParseError('Nenhuma transação válida encontrada no extrato (blocos <STMTTRN> sem FITID/DTPOSTED/TRNAMT).');
  }
  return transactions;
}

// OFX dates are YYYYMMDD(HHMMSS)? with no reliable timezone — this returns just the date
// portion as an ISO-ish 'YYYY-MM-DD HH:MM:SS' at midnight UTC, good enough for the ±window
// day-level matching lib/bankStatementReconciliation.ts does (real bank statements don't
// carry intraday precision anyway, unlike the internal Pix/boleto/TED confirmation timestamps).
export function ofxDateToSqlDate(datePosted: string): string {
  const y = datePosted.slice(0, 4);
  const mo = datePosted.slice(4, 6);
  const d = datePosted.slice(6, 8);
  return `${y}-${mo}-${d} 00:00:00`;
}
