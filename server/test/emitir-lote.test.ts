import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function registerCedente() {
  const email = `cedente-lote-${unique()}@example.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Cedente Lote', email, password: 'senha123', companyName: `Emissora Lote ${unique()} Ltda`, role: 'cedente' });
  return res.body.token as string;
}

async function registerInvestidor() {
  const email = `inv-lote-${unique()}@example.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Investidor Lote', email, password: 'senha123', companyName: `Fundo Lote ${unique()}`, role: 'investidor' });
  return res.body.token as string;
}

describe('POST /api/emitir/lote — real batch emission, each row via the same submitEmitir() path', () => {
  it('emits every valid row for real and reports per-row success', async () => {
    const token = await registerCedente();
    const rows = [
      { sacado: `Sacado Lote A ${unique()}`, cnpj: '', valor: '15.000', vencimento: '2026-12-31', seguro: false },
      { sacado: `Sacado Lote B ${unique()}`, cnpj: '', valor: '22.500', vencimento: '2026-12-31', seguro: false },
      { sacado: `Sacado Lote C ${unique()}`, cnpj: '', valor: '9.000', vencimento: '2026-12-31', seguro: false },
    ];
    const res = await request(app).post('/api/emitir/lote').set('Authorization', `Bearer ${token}`).send({ rows });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(res.body.resultados).toHaveLength(3);
    expect(res.body.sucesso + res.body.falhas).toBe(3);
    // Each row goes through the real registradora call (lib/registradoras.ts), including its
    // documented ~12% simulated instability — a row can genuinely fail here, same as a
    // single manual emission could. What must hold regardless: every row got a real,
    // specific outcome, never a silently-skipped or malformed result.
    for (const r of res.body.resultados) {
      if (r.ok) {
        expect(r.duplicataId).toBeTruthy();
        expect(r.registro).toBeTruthy();
      } else {
        expect(r.error).toBeTruthy();
      }
    }

    // Every row that succeeded really created its own separate duplicata, visible in "Minhas Duplicatas".
    const minhas = await request(app).get('/api/minhas').set('Authorization', `Bearer ${token}`);
    expect(minhas.body.duplicatas.length).toBeGreaterThanOrEqual(res.body.sucesso);
  });

  it('reports per-row failures without failing the whole batch (mixed valid/invalid rows)', async () => {
    const token = await registerCedente();
    const rows = [
      { sacado: `Sacado Lote Válido ${unique()}`, cnpj: '', valor: '12.000', vencimento: '2026-12-31', seguro: false },
      { sacado: '', cnpj: '', valor: '', vencimento: '' }, // invalid — missing required fields
    ];
    const res = await request(app).post('/api/emitir/lote').set('Authorization', `Bearer ${token}`).send({ rows });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.sucesso).toBe(1);
    expect(res.body.falhas).toBe(1);
    expect(res.body.resultados[0].ok).toBe(true);
    expect(res.body.resultados[1].ok).toBe(false);
    expect(res.body.resultados[1].error).toBeTruthy();
  });

  it('rejects an empty batch and a batch over the row limit', async () => {
    const token = await registerCedente();
    const empty = await request(app).post('/api/emitir/lote').set('Authorization', `Bearer ${token}`).send({ rows: [] });
    expect(empty.status).toBe(400);

    const tooMany = Array.from({ length: 201 }, (_, i) => ({ sacado: `Sacado ${i}`, cnpj: '', valor: '1000', vencimento: '2026-12-31', seguro: false }));
    const overLimit = await request(app).post('/api/emitir/lote').set('Authorization', `Bearer ${token}`).send({ rows: tooMany });
    expect(overLimit.status).toBe(400);
  });

  it('rejects a batch from a non-cedente (investidor)', async () => {
    const token = await registerInvestidor();
    const res = await request(app)
      .post('/api/emitir/lote')
      .set('Authorization', `Bearer ${token}`)
      .send({ rows: [{ sacado: 'X', cnpj: '', valor: '1000', vencimento: '2026-12-31', seguro: false }] });
    expect(res.status).toBe(403);
  });
});
