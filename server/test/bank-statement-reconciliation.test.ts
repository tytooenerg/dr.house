import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { addLedgerEntry } from '../src/db/misc.js';

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function adminToken() {
  const res = await request(app).post('/api/auth/login').send({ email: 'admin@lastro.demo', password: 'demo1234' });
  return res.body.token as string;
}

async function registerCedente() {
  const email = `ced-ofx-${unique()}@example.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Cedente OFX', email, password: 'senha123', companyName: `Empresa OFX ${unique()}`, role: 'cedente' });
  return { token: res.body.token as string, userId: res.body.user.id as number, email };
}

function ofxWith(fitid: string, dateYmd: string, amount: number, memo: string): string {
  return `<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST><STMTTRN><TRNTYPE>${amount >= 0 ? 'CREDIT' : 'DEBIT'}\n<DTPOSTED>${dateYmd}120000\n<TRNAMT>${amount.toFixed(2)}\n<FITID>${fitid}\n<MEMO>${memo}\n</STMTTRN></BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
}

describe('Bank statement reconciliation (OFX)', () => {
  it('requires admin role', async () => {
    const { token } = await registerCedente();
    const res = await request(app).post('/api/reconciliation/extrato').set('Authorization', `Bearer ${token}`).send({ email: 'x@x.com', ofxText: 'x' });
    expect(res.status).toBe(403);
  });

  it('404s for an unknown account email', async () => {
    const admin = await adminToken();
    const res = await request(app)
      .post('/api/reconciliation/extrato')
      .set('Authorization', `Bearer ${admin}`)
      .send({ email: `naoexiste-${unique()}@example.com`, ofxText: ofxWith('F1', '20260101', 10, 'x') });
    expect(res.status).toBe(404);
  });

  it('400s on a malformed OFX file', async () => {
    const admin = await adminToken();
    const { email } = await registerCedente();
    const res = await request(app).post('/api/reconciliation/extrato').set('Authorization', `Bearer ${admin}`).send({ email, ofxText: 'not ofx at all' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ofx_parse_error');
  });

  it('matches a bank transaction that has a corresponding ledger entry, and flags one that does not', async () => {
    const admin = await adminToken();
    const { userId, email } = await registerCedente();
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');

    // A real ledger entry for one of the two transactions the "bank" will report.
    addLedgerEntry(userId, new Date().toISOString().slice(0, 10), 'Pix recebido de verdade', 777.5);

    const ofx = `<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>CREDIT\n<DTPOSTED>${today}120000\n<TRNAMT>777.50\n<FITID>BANKTX-MATCHED-${unique()}\n<MEMO>Pix recebido de verdade\n</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT\n<DTPOSTED>${today}130000\n<TRNAMT>999.99\n<FITID>BANKTX-UNMATCHED-${unique()}\n<MEMO>Depósito nunca lançado no Lastro\n</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

    const res = await request(app).post('/api/reconciliation/extrato').set('Authorization', `Bearer ${admin}`).send({ email, ofxText: ofx });
    expect(res.status).toBe(200);
    expect(res.body.transacoes).toBe(2);
    expect(res.body.conferidas).toBe(1);
    expect(res.body.semLancamento).toBe(1);

    const flags = await request(app).get('/api/reconciliation/flags').set('Authorization', `Bearer ${admin}`);
    const flag = flags.body.flags.find((f: { referencia: string }) => f.referencia.startsWith('BANKTX-UNMATCHED'));
    expect(flag).toBeTruthy();
    expect(flag.tipo).toBe('extrato_bancario');
    const matchedShouldNotBeFlagged = flags.body.flags.find((f: { referencia: string }) => f.referencia.startsWith('BANKTX-MATCHED'));
    expect(matchedShouldNotBeFlagged).toBeUndefined();
  });
});
