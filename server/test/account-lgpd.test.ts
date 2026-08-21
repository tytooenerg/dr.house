import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function registerCedente() {
  const email = `lgpd-${unique()}@example.com`;
  const reg = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Dono LGPD', email, password: 'senha123', companyName: `Empresa LGPD ${unique()}`, role: 'cedente' });
  return { token: reg.body.token as string, email };
}

describe('LGPD — data export', () => {
  it('exports the account profile, settings and financial data as JSON', async () => {
    const { token } = await registerCedente();
    const res = await request(app).get('/api/account/export').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.perfil.email).toBeTruthy();
    expect(res.body.perfil.role).toBe('cedente');
    expect(Array.isArray(res.body.duplicatasComoCedente)).toBe(true);
    expect(Array.isArray(res.body.chavesDeApi)).toBe(true);
    expect(Array.isArray(res.body.webhooks)).toBe(true);
  });
});

describe('LGPD — account deletion', () => {
  it('rejects deletion with the wrong password', async () => {
    const { token } = await registerCedente();
    const res = await request(app).post('/api/account/delete').set('Authorization', `Bearer ${token}`).send({ password: 'senha-errada' });
    expect(res.status).toBe(401);
  });

  it('anonymizes the account, revokes sessions and prevents future login with the original email', async () => {
    const { token, email } = await registerCedente();

    const res = await request(app).post('/api/account/delete').set('Authorization', `Bearer ${token}`).send({ password: 'senha123' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const loginAttempt = await request(app).post('/api/auth/login').send({ email, password: 'senha123' });
    expect(loginAttempt.status).toBe(401);

    const meAfter = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(meAfter.status).toBe(200);
    expect(meAfter.body.user.nome).toBe('Usuário removido');
  });
});
