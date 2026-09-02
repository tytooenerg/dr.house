import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { upsertErpPayables, listByCedente } from '../src/db/payables.js';

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function registerCedente() {
  const email = `ced-erp-payables-${unique()}@example.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Cedente ERP Payables', email, password: 'senha123', companyName: `Empresa ERP Payables ${unique()}`, role: 'cedente' });
  return { token: res.body.token as string, userId: res.body.user.id as number };
}

describe('Contas a Pagar via ERP (feature "Contas a Pagar via ERP")', () => {
  it('upsertErpPayables cria uma conta a pagar de verdade, visível em Contas a Pagar', async () => {
    const { token, userId } = await registerCedente();
    upsertErpPayables(userId, 'omie', [{ externalId: 'omie-1', fornecedor: 'Fornecedor Omie Ltda', numeroDocumento: 'NF-100', valor: 8000, vencimento: '2026-12-01' }]);

    const overview = await request(app).get('/api/payables').set('Authorization', `Bearer ${token}`);
    expect(overview.status).toBe(200);
    expect(overview.body.items).toHaveLength(1);
    expect(overview.body.items[0].valor).toBe(8000);
    expect(overview.body.totalPendente).toBe(8000);
  });

  it('re-sincronizar o mesmo external_id atualiza a linha existente, em vez de duplicar', async () => {
    const { userId } = await registerCedente();
    upsertErpPayables(userId, 'omie', [{ externalId: 'omie-2', fornecedor: 'Fornecedor A', numeroDocumento: 'NF-1', valor: 1000, vencimento: '2026-12-01' }]);
    upsertErpPayables(userId, 'omie', [{ externalId: 'omie-2', fornecedor: 'Fornecedor A', numeroDocumento: 'NF-1', valor: 1500, vencimento: '2026-12-15' }]);

    const rows = listByCedente(userId);
    expect(rows).toHaveLength(1);
    expect(rows[0].valor).toBe(1500);
    expect(rows[0].vencimento).toBe('2026-12-15');
  });

  it('external_ids diferentes da mesma fonte criam linhas separadas', async () => {
    const { userId } = await registerCedente();
    upsertErpPayables(userId, 'sap', [
      { externalId: 'sap-1', fornecedor: 'Fornecedor SAP 1', numeroDocumento: 'DOC1', valor: 500, vencimento: '2026-12-01' },
      { externalId: 'sap-2', fornecedor: 'Fornecedor SAP 2', numeroDocumento: 'DOC2', valor: 700, vencimento: '2026-12-01' },
    ]);
    expect(listByCedente(userId)).toHaveLength(2);
  });

  it('mesmo external_id em fontes diferentes (omie vs sap) não colide — linhas independentes', async () => {
    const { userId } = await registerCedente();
    upsertErpPayables(userId, 'omie', [{ externalId: 'dup-id', fornecedor: 'Fornecedor Omie', numeroDocumento: 'A', valor: 100, vencimento: '2026-12-01' }]);
    upsertErpPayables(userId, 'sap', [{ externalId: 'dup-id', fornecedor: 'Fornecedor SAP', numeroDocumento: 'B', valor: 200, vencimento: '2026-12-01' }]);
    expect(listByCedente(userId)).toHaveLength(2);
  });

  it('uma conta a pagar sincronizada do ERP entra na projeção do AI CFO como qualquer outra', async () => {
    const { token, userId } = await registerCedente();
    await request(app).post('/api/billing/checkout').set('Authorization', `Bearer ${token}`).send({ plan: 'pro' });
    upsertErpPayables(userId, 'totvs', [{ externalId: 'totvs-1', fornecedor: 'Fornecedor TOTVS', numeroDocumento: 'F1', valor: 3000, vencimento: '2026-12-01' }]);

    const forecast = await request(app).get('/api/cashflow/forecast').set('Authorization', `Bearer ${token}`);
    expect(forecast.status).toBe(200);
    expect(forecast.body.totalContasAPagarPendentesFmt).toContain('3.000');
  });

  it('uma conta a pagar sincronizada pode ser marcada como paga pelo fluxo normal', async () => {
    const { token, userId } = await registerCedente();
    upsertErpPayables(userId, 'omie', [{ externalId: 'omie-pay', fornecedor: 'Fornecedor a Pagar', numeroDocumento: 'X', valor: 400, vencimento: '2026-12-01' }]);
    const overview = await request(app).get('/api/payables').set('Authorization', `Bearer ${token}`);
    const id = overview.body.items[0].id;

    const pay = await request(app).post(`/api/payables/${id}/pagar`).set('Authorization', `Bearer ${token}`);
    expect(pay.status).toBe(200);

    const after = await request(app).get('/api/payables').set('Authorization', `Bearer ${token}`);
    expect(after.body.items.find((i: { id: number }) => i.id === id).status).toBe('pago');
  });
});
