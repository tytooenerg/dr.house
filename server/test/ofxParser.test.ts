import { describe, expect, it } from 'vitest';
import { parseOfx, ofxDateToSqlDate, OfxParseError } from '../src/lib/ofxParser.js';

// A real (trimmed) OFX 1.x SGML statement shape — unclosed tags, one per line, exactly
// what Brazilian banks (Itaú, Bradesco, BB, Nubank...) export as "extrato OFX".
const SAMPLE_OFX = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<STMTRS>
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260810120000
<TRNAMT>1500.00
<FITID>FIT001
<MEMO>Pix recebido
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260811090000
<TRNAMT>-250.50
<FITID>FIT002
<MEMO>Tarifa bancária
</STMTTRN>
</BANKTRANLIST>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>`;

describe('OFX parser', () => {
  it('parses every STMTTRN block into a real transaction', () => {
    const txs = parseOfx(SAMPLE_OFX);
    expect(txs).toHaveLength(2);
    expect(txs[0]).toMatchObject({ fitid: 'FIT001', trnType: 'CREDIT', datePosted: '20260810', amount: 1500 });
    expect(txs[1]).toMatchObject({ fitid: 'FIT002', trnType: 'DEBIT', datePosted: '20260811', amount: -250.5 });
    expect(txs[0].memo).toContain('Pix recebido');
  });

  it('rejects a file with no <STMTTRN> blocks at all', () => {
    expect(() => parseOfx('not an ofx file')).toThrow(OfxParseError);
  });

  it('skips a malformed block missing FITID/DTPOSTED/TRNAMT instead of failing the whole file', () => {
    const partial = `<STMTTRN>\n<TRNTYPE>CREDIT\n<MEMO>sem valor nem data\n</STMTTRN>\n<STMTTRN>\n<TRNTYPE>CREDIT\n<DTPOSTED>20260101000000\n<TRNAMT>10.00\n<FITID>OK1\n</STMTTRN>`;
    const txs = parseOfx(partial);
    expect(txs).toHaveLength(1);
    expect(txs[0].fitid).toBe('OK1');
  });

  it('converts an OFX date into a matchable SQL datetime', () => {
    expect(ofxDateToSqlDate('20260315143000')).toBe('2026-03-15 00:00:00');
  });
});
