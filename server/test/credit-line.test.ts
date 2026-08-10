import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { createDuplicata } from '../src/db/duplicatas.js';
import { ensureAceite } from '../src/db/aceites.js';
import { createDispute } from '../src/db/disputes.js';
import { getFundBalance } from '../src/db/creditLineFund.js';

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function registerCedente() {
  const email = `ced-credit-${unique()}@example.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Cedente Crédito', email, password: 'senha123', companyName: `Empresa Crédito ${unique()}`, role: 'cedente' });
  return { token: res.body.token as string, userId: res.body.user.id as number };
}

// Draws are now financed by a real investor pool (lib/creditLineFund.ts), not unlimited
// Lastro capital — most draw/repay tests need real liquidity in that pool first.
async function seedFundLiquidity(valor: number) {
  const email = `inv-credit-fund-${unique()}@example.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Investidor Fomento', email, password: 'senha123', companyName: `Fomento ${unique()}`, role: 'investidor' });
  const token = res.body.token as string;
  await request(app).post('/api/credit-line-fund/contribuir').set('Authorization', `Bearer ${token}`).send({ valor });
  return token;
}

function seedRecentDuplicatas(cedenteId: number, count: number, valorEach: number, sacadoNome = 'Sacado Genérico Crédito') {
  for (let i = 0; i < count; i++) {
    createDuplicata({
      cedenteId,
      cedenteNome: 'Cedente Crédito',
      sacadoNome,
      sacadoCnpj: '',
      valor: valorEach,
      vencimento: '2026-12-31',
      emissao: '10/08/2026',
      status: 'aprovada',
      lastroPct: 100,
      seguro: false,
    });
  }
}

describe('Credit line — eligibility from real 90-day emission history', () => {
  it('is not eligible with fewer than 3 real duplicatas in the last 90 days', async () => {
    const { token, userId } = await registerCedente();
    seedRecentDuplicatas(userId, 2, 50000);

    const res = await request(app).get('/api/credit-line').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.eligible).toBe(false);
    expect(res.body.motivo).toContain('3 duplicatas');
  });

  it('becomes eligible with 3+ real duplicatas and computes a real, non-zero limit and rate', async () => {
    const { token, userId } = await registerCedente();
    seedRecentDuplicatas(userId, 4, 60000);

    const res = await request(app).get('/api/credit-line').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.eligible).toBe(true);
    expect(res.body.limite).toBeGreaterThan(0);
    expect(res.body.utilizado).toBe(0);
    expect(res.body.disponivel).toBe(res.body.limite);
    expect(res.body.taxaAmFmt).toMatch(/% a\.m\./);
  });

  it('is suspended (not eligible) while the cedente has an open dispute', async () => {
    const { token, userId } = await registerCedente();
    seedRecentDuplicatas(userId, 4, 60000, 'Sacado Disputa Crédito');

    // Build a real dispute against one of this cedente's aceites.
    const d = createDuplicata({
      cedenteId: userId,
      cedenteNome: 'Cedente Crédito',
      sacadoNome: 'Sacado Disputa Crédito',
      sacadoCnpj: '',
      valor: 30000,
      vencimento: '2026-12-31',
      emissao: '10/08/2026',
      status: 'aprovada',
      lastroPct: 100,
      seguro: false,
    });
    const aceite = ensureAceite(d.id, '5 dias úteis');
    createDispute(aceite.id, 'Divergência de valor', { autor: 'Sacado', texto: 'Contestação de teste.' });

    const res = await request(app).get('/api/credit-line').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.eligible).toBe(false);
    expect(res.body.motivo).toContain('disputa');
  });
});

describe('Credit line — draw and repay', () => {
  it('draws within the available limit, updates disponivel, and rejects a draw exceeding it', async () => {
    const { token, userId } = await registerCedente();
    seedRecentDuplicatas(userId, 4, 200000);

    const overview = await request(app).get('/api/credit-line').set('Authorization', `Bearer ${token}`);
    const limite = overview.body.limite as number;
    expect(limite).toBeGreaterThan(1000);
    await seedFundLiquidity(limite); // enough pool liquidity for every draw in this test

    const drawValor = Math.floor(limite * 0.4);
    const draw = await request(app).post('/api/credit-line/draw').set('Authorization', `Bearer ${token}`).send({ valor: drawValor });
    expect(draw.status).toBe(200);

    const after = await request(app).get('/api/credit-line').set('Authorization', `Bearer ${token}`);
    // A sliver of real interest accrues between the draw and this read (lib/creditLine.ts's
    // lazy per-day proration) — utilizado is never less than the draw and never more than a
    // fraction of a real over the few milliseconds elapsed in a test run.
    expect(after.body.utilizado).toBeGreaterThanOrEqual(drawValor);
    expect(after.body.utilizado - drawValor).toBeLessThan(1);
    expect(after.body.draws).toHaveLength(1);
    expect(after.body.draws[0].status).toBe('aberto');

    const tooMuch = await request(app)
      .post('/api/credit-line/draw')
      .set('Authorization', `Bearer ${token}`)
      .send({ valor: limite }); // limite alone already exceeds what remains after the first draw
    expect(tooMuch.status).toBe(409);
    expect(tooMuch.body.error).toBe('limit_exceeded');
  });

  it('repays an open draw and settles it fully when the payment covers the balance', async () => {
    const { token, userId } = await registerCedente();
    seedRecentDuplicatas(userId, 4, 200000);
    const overview = await request(app).get('/api/credit-line').set('Authorization', `Bearer ${token}`);
    const drawValor = Math.floor((overview.body.limite as number) * 0.3);
    await seedFundLiquidity(drawValor);
    await request(app).post('/api/credit-line/draw').set('Authorization', `Bearer ${token}`).send({ valor: drawValor });

    // Overpay on purpose (covers principal + any accrued interest) — extra is simply not applied further.
    const repay = await request(app)
      .post('/api/credit-line/repay')
      .set('Authorization', `Bearer ${token}`)
      .send({ valor: drawValor * 1.5 });
    expect(repay.status).toBe(200);

    const after = await request(app).get('/api/credit-line').set('Authorization', `Bearer ${token}`);
    expect(after.body.utilizado).toBe(0);
    expect(after.body.draws[0].status).toBe('quitado');

    // The cedente's own ledger reflects both the draw (credit) and the repayment (debit).
    const extrato = await request(app).get('/api/account').set('Authorization', `Bearer ${token}`);
    const descriptions = extrato.body.extrato.map((e: { descricao: string }) => e.descricao);
    expect(descriptions.some((d: string) => d.includes('Saque da linha de crédito'))).toBe(true);
    expect(descriptions.some((d: string) => d.includes('Pagamento da linha de crédito'))).toBe(true);
  });

  it('rejects a draw when the investor pool lacks liquidity, even though the cedente is within their own limit', async () => {
    // Other tests in this file may have already contributed real liquidity to the pool
    // (test isolation here is per-file, not per-test) — read the real current balance
    // rather than assuming zero, and request comfortably more than that, still well within
    // this cedente's own limit (a very large recent-emission volume).
    const balanceBefore = getFundBalance();
    const { token, userId } = await registerCedente();
    seedRecentDuplicatas(userId, 4, Math.max(500000, (balanceBefore + 100000) * 2));
    const overview = await request(app).get('/api/credit-line').set('Authorization', `Bearer ${token}`);
    const limite = overview.body.limite as number;
    const drawValor = balanceBefore + 50000;
    expect(limite).toBeGreaterThan(drawValor); // the cedente's own limit is not the binding constraint here

    const res = await request(app).post('/api/credit-line/draw').set('Authorization', `Bearer ${token}`).send({ valor: drawValor });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('fund_insufficient');
  });

  it('rejects a repay with no open balance and a draw/repay of a non-positive amount', async () => {
    const { token, userId } = await registerCedente();
    seedRecentDuplicatas(userId, 4, 60000);

    const badDraw = await request(app).post('/api/credit-line/draw').set('Authorization', `Bearer ${token}`).send({ valor: -10 });
    expect(badDraw.status).toBe(400);

    const noBalance = await request(app).post('/api/credit-line/repay').set('Authorization', `Bearer ${token}`).send({ valor: 100 });
    expect(noBalance.status).toBe(404);
  });
});
