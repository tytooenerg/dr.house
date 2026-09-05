import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { arrematar, darLance, fecharLeiloes } from './helpers/auction.js';

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

describe('admin authorization', () => {
  it('is forbidden for non-admin roles', async () => {
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ nome: 'Carlos', email: `ced-${unique()}@example.com`, password: 'senha123', companyName: 'C Ltda', role: 'cedente' });
    const res = await request(app).get('/api/admin/kyb').set('Authorization', `Bearer ${reg.body.token}`);
    expect(res.status).toBe(403);
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/admin/kyb');
    expect(res.status).toBe(401);
  });
});

describe('KYB approval flow', () => {
  it('blocks buying until KYB is approved, then allows it once an admin approves', async () => {
    const email = `inv-${unique()}@example.com`;
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ nome: 'Nova Investidora', email, password: 'senha123', companyName: 'Fundo Nova', role: 'investidor' });
    const token = reg.body.token as string;
    const userId = reg.body.user.id as number;

    await request(app)
      .post('/api/auth/kyb')
      .set('Authorization', `Bearer ${token}`)
      .send({ cnpj: '11.111.111/0001-11', tipo: 'Fundo (FIDC)', pl: '10.000.000' });

    const market = await request(app).get('/api/market').set('Authorization', `Bearer ${token}`);
    const buyable = market.body.offers.find((o: { canBuy: boolean }) => o.canBuy);
    const blocked = (await arrematar(token, buyable.id)).lance;
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toBe('kyb_required');

    const adminTok = await adminToken();
    const pending = await request(app).get('/api/admin/kyb').set('Authorization', `Bearer ${adminTok}`);
    expect(pending.body.pending.some((p: { id: number }) => p.id === userId)).toBe(true);

    const approve = await request(app).post(`/api/admin/kyb/${userId}/approve`).set('Authorization', `Bearer ${adminTok}`);
    expect(approve.status).toBe(200);

    const allowed = (await arrematar(token, buyable.id)).lance;
    expect(allowed.status).toBe(200);
  });

  it('rejects KYB with a reason and requires resubmission', async () => {
    const email = `inv-${unique()}@example.com`;
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ nome: 'Investidora Rejeitada', email, password: 'senha123', companyName: 'Fundo Rejeitado', role: 'investidor' });
    const token = reg.body.token as string;
    const userId = reg.body.user.id as number;

    await request(app).post('/api/auth/kyb').set('Authorization', `Bearer ${token}`).send({ cnpj: '22.222.222/0001-22' });

    const adminTok = await adminToken();
    const reject = await request(app)
      .post(`/api/admin/kyb/${userId}/reject`)
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ reason: 'Documentação incompleta' });
    expect(reject.status).toBe(200);

    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(me.body.user.kybStatus).toBe('rejected');
    expect(me.body.user.needsKyb).toBe(true);
    expect(me.body.user.kybRejectReason).toBe('Documentação incompleta');
  });
});

describe('audit log', () => {
  it('produces a valid hash chain after a run of actions', async () => {
    const email = `ced-${unique()}@example.com`;
    await request(app).post('/api/auth/register').send({ nome: 'Empresa', email, password: 'senha123', companyName: 'Empresa Auditada Ltda', role: 'cedente' });

    const adminTok = await adminToken();
    const audit = await request(app).get('/api/admin/audit').set('Authorization', `Bearer ${adminTok}`);
    expect(audit.status).toBe(200);
    expect(audit.body.chain.valid).toBe(true);
    expect(audit.body.entries.length).toBeGreaterThan(0);
  });
});
