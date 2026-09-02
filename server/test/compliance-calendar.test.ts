import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { approveKyb } from '../src/db/users.js';
import { listAuditLog } from '../src/db/audit.js';
import { classifyCompliance, OBRIGATORIEDADE_POR_BRACKET } from '../src/lib/complianceCalendarCore.js';

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function register(role: 'cedente' | 'sacado' | 'investidor') {
  const email = `conf-${role}-${unique()}@example.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Empresa Teste', email, password: 'senha123', companyName: `Empresa ${unique()}`, role });
  approveKyb(res.body.user.id);
  return { token: res.body.token as string, userId: res.body.user.id as number };
}

async function loginAdmin() {
  const res = await request(app).post('/api/auth/login').send({ email: 'admin@lastro.demo', password: 'demo1234' });
  return { token: res.body.token as string };
}

describe('classifyCompliance — pure classification', () => {
  it('returns nao_informado when no bracket was reported', () => {
    const view = classifyCompliance(null);
    expect(view.status).toBe('nao_informado');
    expect(view.bracket).toBeNull();
    expect(view.diasRestantes).toBeNull();
  });

  it('returns assistida_disponivel with positive days remaining before the deadline', () => {
    const deadline = OBRIGATORIEDADE_POR_BRACKET.acima_300m;
    const before = new Date(deadline.getTime() - 10 * 24 * 60 * 60 * 1000);
    const view = classifyCompliance('acima_300m', before);
    expect(view.status).toBe('assistida_disponivel');
    expect(view.diasRestantes).toBe(10);
    expect(view.bracketLabel).toBe('Acima de R$ 300 milhões/ano');
  });

  it('returns obrigatorio_pleno with zero days remaining once the deadline has passed', () => {
    const deadline = OBRIGATORIEDADE_POR_BRACKET.ate_4_8m;
    const after = new Date(deadline.getTime() + 24 * 60 * 60 * 1000);
    const view = classifyCompliance('ate_4_8m', after);
    expect(view.status).toBe('obrigatorio_pleno');
    expect(view.diasRestantes).toBe(0);
  });
});

describe('GET/POST /api/conformidade', () => {
  it('starts as nao_informado for a fresh cedente', async () => {
    const { token } = await register('cedente');
    const res = await request(app).get('/api/conformidade').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('nao_informado');
    expect(res.body.bracket).toBeNull();
  });

  it('persists the reported bracket and reflects it on a later GET', async () => {
    const { token } = await register('sacado');
    const post = await request(app).post('/api/conformidade/faturamento').set('Authorization', `Bearer ${token}`).send({ bracket: 'entre_4_8m_90m' });
    expect(post.status).toBe(200);
    expect(post.body.bracket).toBe('entre_4_8m_90m');
    expect(post.body.status).not.toBe('nao_informado');

    const get = await request(app).get('/api/conformidade').set('Authorization', `Bearer ${token}`);
    expect(get.body.bracket).toBe('entre_4_8m_90m');
  });

  it('rejects an invalid bracket', async () => {
    const { token } = await register('cedente');
    const res = await request(app).post('/api/conformidade/faturamento').set('Authorization', `Bearer ${token}`).send({ bracket: 'gigante' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
  });

  it('blocks roles other than cedente/sacado', async () => {
    const { token } = await register('investidor');
    const res = await request(app).get('/api/conformidade').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('records an audit event when the bracket is reported', async () => {
    const { token, userId } = await register('cedente');
    await request(app).post('/api/conformidade/faturamento').set('Authorization', `Bearer ${token}`).send({ bracket: 'acima_300m' });
    const entry = listAuditLog(50).find((e) => e.actor_user_id === userId && e.action === 'compliance_calendario.faturamento_informado');
    expect(entry).toBeDefined();
    expect(JSON.parse(entry!.payload).bracket).toBe('acima_300m');
  });
});

describe('GET /api/admin/conformidade-escritural', () => {
  it('includes a cedente that just reported its bracket, with counts by status', async () => {
    const { token } = await register('cedente');
    await request(app).post('/api/conformidade/faturamento').set('Authorization', `Bearer ${token}`).send({ bracket: 'entre_90m_300m' });

    const admin = await loginAdmin();
    const res = await request(app).get('/api/admin/conformidade-escritural').set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    expect(res.body.rows.length).toBeGreaterThan(0);
    expect(res.body.countsByStatus).toHaveProperty('nao_informado');
    expect(res.body.countsByStatus).toHaveProperty('assistida_disponivel');
    expect(res.body.countsByStatus).toHaveProperty('obrigatorio_pleno');
  });

  it('blocks non-admin roles', async () => {
    const { token } = await register('cedente');
    const res = await request(app).get('/api/admin/conformidade-escritural').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});
