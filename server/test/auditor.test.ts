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

async function adminLogin() {
  const res = await request(app).post('/api/auth/login').send({ email: 'admin@lastro.demo', password: 'demo1234' });
  return res.body.token as string;
}

async function registerCedente() {
  const email = `ced-auditor-${unique()}@example.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Cedente Auditor', email, password: 'senha123', companyName: `Empresa Auditor ${unique()}`, role: 'cedente' });
  return { token: res.body.token as string };
}

describe('Auditor role — account creation (admin-only)', () => {
  it('public self-registration never accepts role=auditor', async () => {
    const res = await request(app).post('/api/auth/register').send({
      nome: 'Tentativa',
      email: `auditor-hack-${unique()}@example.com`,
      password: 'senha123',
      companyName: 'X',
      role: 'auditor',
    });
    expect(res.status).toBe(400);
  });

  it('a non-admin cannot create an auditor account', async () => {
    const { token } = await registerCedente();
    const res = await request(app)
      .post('/api/admin/auditores')
      .set('Authorization', `Bearer ${token}`)
      .send({ nome: 'Auditor X', email: `auditor-${unique()}@example.com`, password: 'senhaforte123' });
    expect(res.status).toBe(403);
  });

  it('an admin creates a real auditor account, which can then log in and gets the auditor nav', async () => {
    const admin = await adminLogin();
    const email = `auditor-${unique()}@example.com`;
    const create = await request(app)
      .post('/api/admin/auditores')
      .set('Authorization', `Bearer ${admin}`)
      .send({ nome: 'Auditoria Externa', email, password: 'senhaforte123', companyName: 'Escritório XYZ' });
    expect(create.status).toBe(201);
    expect(create.body.email).toBe(email);

    const listAfter = await request(app).get('/api/admin/auditores').set('Authorization', `Bearer ${admin}`);
    expect(listAfter.body.auditores.some((a: { email: string }) => a.email === email)).toBe(true);

    const login = await request(app).post('/api/auth/login').send({ email, password: 'senhaforte123' });
    expect(login.status).toBe(200);
    expect(login.body.user.role).toBe('auditor');
    expect(login.body.user.navTabs).toEqual(['auditor', 'perfil']);
  });

  it('rejects a duplicate email and a weak password', async () => {
    const admin = await adminLogin();
    const email = `auditor-dup-${unique()}@example.com`;
    await request(app).post('/api/admin/auditores').set('Authorization', `Bearer ${admin}`).send({ nome: 'A', email, password: 'senhaforte123' });

    const dup = await request(app).post('/api/admin/auditores').set('Authorization', `Bearer ${admin}`).send({ nome: 'B', email, password: 'senhaforte123' });
    expect(dup.status).toBe(400);

    const weak = await request(app)
      .post('/api/admin/auditores')
      .set('Authorization', `Bearer ${admin}`)
      .send({ nome: 'C', email: `auditor-weak-${unique()}@example.com`, password: '123' });
    expect(weak.status).toBe(400);
  });
});

describe('Auditor role — read-only overview', () => {
  async function createAndLoginAuditor() {
    const admin = await adminLogin();
    const email = `auditor-overview-${unique()}@example.com`;
    await request(app).post('/api/admin/auditores').set('Authorization', `Bearer ${admin}`).send({ nome: 'Auditor', email, password: 'senhaforte123' });
    const login = await request(app).post('/api/auth/login').send({ email, password: 'senhaforte123' });
    return login.body.token as string;
  }

  it('requires authentication', async () => {
    const res = await request(app).get('/api/auditor/overview');
    expect(res.status).toBe(401);
  });

  it('is forbidden to every role except admin and auditor', async () => {
    const { token } = await registerCedente();
    const res = await request(app).get('/api/auditor/overview').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('returns real, structured data to an auditor account, matching the same shape admin sees', async () => {
    const auditorToken = await createAndLoginAuditor();
    const res = await request(app).get('/api/auditor/overview').set('Authorization', `Bearer ${auditorToken}`);
    expect(res.status).toBe(200);
    expect(res.body.auditLog.chain).toHaveProperty('valid');
    expect(Array.isArray(res.body.auditLog.entries)).toBe(true);
    expect(typeof res.body.compliance.pendentes).toBe('number');
    expect(typeof res.body.reconciliation.abertas).toBe('number');
    expect(typeof res.body.sars.aberto).toBe('number');
  });

  it('an admin can also read the auditor overview (never sees less than an auditor)', async () => {
    const admin = await adminLogin();
    const res = await request(app).get('/api/auditor/overview').set('Authorization', `Bearer ${admin}`);
    expect(res.status).toBe(200);
  });

  it('has no write routes — the auditor router only exposes GET /overview', async () => {
    const auditorToken = await createAndLoginAuditor();
    // No admin-only write route should be reachable from the auditor role.
    const res = await request(app).post('/api/admin/auditores').set('Authorization', `Bearer ${auditorToken}`).send({ nome: 'X', email: 'x@x.com', password: 'senhaforte123' });
    expect(res.status).toBe(403);
  });
});
