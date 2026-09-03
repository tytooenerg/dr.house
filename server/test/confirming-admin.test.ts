import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';

beforeAll(async () => {
  await seedIfEmpty();
});

function unique(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function register(role: 'cedente' | 'sacado', companyName: string) {
  const email = `${unique(role)}@example.com`;
  const res = await request(app).post('/api/auth/register').send({ nome: 'Teste', email, password: 'senha123', companyName, role });
  return { token: res.body.token as string, userId: res.body.user.id as number };
}

async function loginAdmin() {
  const res = await request(app).post('/api/auth/login').send({ email: 'admin@lastro.demo', password: 'demo1234' });
  return { token: res.body.token as string };
}

const CNPJ_COM_HISTORICO = '12.345.678/0001-90';

describe('GET /api/admin/confirming — oversight do Programa Confirming', () => {
  it('lists a program the sacado just created, with its own enrollment count and fund overview', async () => {
    const sacadoCompany = unique('Sacado Oversight');
    const { token: sacadoToken } = await register('sacado', sacadoCompany);
    const { userId: cedenteUserId } = await register('cedente', unique('Fornecedor Oversight'));
    await request(app).post('/api/confirming/criar').set('Authorization', `Bearer ${sacadoToken}`).send({ cnpj: CNPJ_COM_HISTORICO, limite: '300.000' });
    await request(app).post('/api/confirming/membros').set('Authorization', `Bearer ${sacadoToken}`).send({ cedenteUserId });

    const admin = await loginAdmin();
    const res = await request(app).get('/api/admin/confirming').set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    expect(res.body.fundo.balanceFmt).toBeTruthy();

    const programa = res.body.programas.find((p: { sacadoNome: string }) => p.sacadoNome === sacadoCompany);
    expect(programa).toBeDefined();
    expect(programa.status).toBe('ativo');
    expect(programa.membrosAtivos).toBe(1);
    expect(programa.limiteFmt).toContain('300.000');
  });

  it('blocks non-admin roles', async () => {
    const { token } = await register('sacado', unique('Sacado Sem Acesso'));
    const res = await request(app).get('/api/admin/confirming').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});
