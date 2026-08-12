import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function registerCedente() {
  const email = `ced-payables-${unique()}@example.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Cedente Payables', email, password: 'senha123', companyName: `Empresa Payables ${unique()}`, role: 'cedente' });
  return { token: res.body.token as string, userId: res.body.user.id as number };
}

async function registerInvestidor() {
  const email = `inv-payables-${unique()}@example.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Investidor Payables', email, password: 'senha123', companyName: `Fundo Payables ${unique()}`, role: 'investidor' });
  return { token: res.body.token as string };
}

describe('Contas a Pagar', () => {
  it('requires cedente role', async () => {
    const { token } = await registerInvestidor();
    const res = await request(app).get('/api/payables').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('creates a payable, lists it in the overview, and totals reflect it', async () => {
    const { token } = await registerCedente();
    const create = await request(app)
      .post('/api/payables')
      .set('Authorization', `Bearer ${token}`)
      .send({ descricao: 'Aluguel do escritório', fornecedor: 'Imobiliária X', categoria: 'aluguel', valor: 5000, vencimento: '2026-12-01' });
    expect(create.status).toBe(201);
    expect(create.body.status).toBe('pendente');
    expect(create.body.valorFmt).toContain('5.000');

    const overview = await request(app).get('/api/payables').set('Authorization', `Bearer ${token}`);
    expect(overview.status).toBe(200);
    expect(overview.body.items).toHaveLength(1);
    expect(overview.body.totalPendente).toBe(5000);
  });

  it('rejects an invalid payable (missing description, non-positive valor)', async () => {
    const { token } = await registerCedente();
    const res = await request(app)
      .post('/api/payables')
      .set('Authorization', `Bearer ${token}`)
      .send({ descricao: '', valor: -10, vencimento: '2026-12-01' });
    expect(res.status).toBe(400);
  });

  it('flags a payable with a past vencimento as atrasado', async () => {
    const { token } = await registerCedente();
    await request(app)
      .post('/api/payables')
      .set('Authorization', `Bearer ${token}`)
      .send({ descricao: 'Imposto vencido', valor: 1200, vencimento: '2020-01-01' });

    const overview = await request(app).get('/api/payables').set('Authorization', `Bearer ${token}`);
    expect(overview.body.items[0].atrasado).toBe(true);
    expect(overview.body.countAtrasado).toBe(1);
    expect(overview.body.totalAtrasado).toBe(1200);
  });

  it('marks a payable as paid, and it stops counting toward totals', async () => {
    const { token } = await registerCedente();
    const create = await request(app)
      .post('/api/payables')
      .set('Authorization', `Bearer ${token}`)
      .send({ descricao: 'Fornecedor A', valor: 800, vencimento: '2026-12-01' });
    const id = create.body.id;

    const pay = await request(app).post(`/api/payables/${id}/pagar`).set('Authorization', `Bearer ${token}`);
    expect(pay.status).toBe(200);

    const overview = await request(app).get('/api/payables').set('Authorization', `Bearer ${token}`);
    const item = overview.body.items.find((i: { id: number }) => i.id === id);
    expect(item.status).toBe('pago');
    expect(overview.body.totalPendente).toBe(0);
  });

  it('cancels and deletes a payable', async () => {
    const { token } = await registerCedente();
    const create = await request(app)
      .post('/api/payables')
      .set('Authorization', `Bearer ${token}`)
      .send({ descricao: 'Cancelável', valor: 300, vencimento: '2026-12-01' });
    const id = create.body.id;

    const cancel = await request(app).post(`/api/payables/${id}/cancelar`).set('Authorization', `Bearer ${token}`);
    expect(cancel.status).toBe(200);

    const del = await request(app).delete(`/api/payables/${id}`).set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(200);

    const overview = await request(app).get('/api/payables').set('Authorization', `Bearer ${token}`);
    expect(overview.body.items.find((i: { id: number }) => i.id === id)).toBeUndefined();
  });

  it('forbids acting on another cedente\'s payable', async () => {
    const owner = await registerCedente();
    const other = await registerCedente();
    const create = await request(app)
      .post('/api/payables')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ descricao: 'Privado', valor: 100, vencimento: '2026-12-01' });
    const id = create.body.id;

    const res = await request(app).post(`/api/payables/${id}/pagar`).set('Authorization', `Bearer ${other.token}`);
    expect(res.status).toBe(403);
  });
});
