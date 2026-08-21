import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';

function uniqueEmail() {
  return `test-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
}

describe('POST /api/auth/register', () => {
  it('creates an account and returns a token + user', async () => {
    const email = uniqueEmail();
    const res = await request(app).post('/api/auth/register').send({
      nome: 'Ana Teste',
      email,
      password: 'senha123',
      companyName: 'Ana Ltda',
      role: 'cedente',
    });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeTypeOf('string');
    expect(res.body.user.email).toBe(email.toLowerCase());
    expect(res.body.user.role).toBe('cedente');
    expect(res.body.user.needsKyb).toBe(false); // only investidor needs KYB
  });

  it('flags needsKyb for a new investidor account', async () => {
    const res = await request(app).post('/api/auth/register').send({
      nome: 'Investidor Teste',
      email: uniqueEmail(),
      password: 'senha123',
      companyName: 'Fundo Teste',
      role: 'investidor',
    });
    expect(res.status).toBe(201);
    expect(res.body.user.needsKyb).toBe(true);
  });

  it('rejects a weak password', async () => {
    const res = await request(app).post('/api/auth/register').send({
      nome: 'Ana Teste',
      email: uniqueEmail(),
      password: '123',
      companyName: 'Ana Ltda',
      role: 'cedente',
    });
    expect(res.status).toBe(400);
  });

  it('rejects a duplicate email', async () => {
    const email = uniqueEmail();
    const payload = { nome: 'Ana Teste', email, password: 'senha123', companyName: 'Ana Ltda', role: 'cedente' as const };
    const first = await request(app).post('/api/auth/register').send(payload);
    expect(first.status).toBe(201);
    const second = await request(app).post('/api/auth/register').send(payload);
    expect(second.status).toBe(409);
  });
});

describe('POST /api/auth/login', () => {
  it('logs in with correct credentials', async () => {
    const email = uniqueEmail();
    await request(app).post('/api/auth/register').send({ nome: 'Ana', email, password: 'senha123', companyName: 'Ana Ltda', role: 'cedente' });
    const res = await request(app).post('/api/auth/login').send({ email, password: 'senha123' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTypeOf('string');
  });

  it('rejects a wrong password without leaking whether the email exists', async () => {
    const email = uniqueEmail();
    await request(app).post('/api/auth/register').send({ nome: 'Ana', email, password: 'senha123', companyName: 'Ana Ltda', role: 'cedente' });
    const wrongPassword = await request(app).post('/api/auth/login').send({ email, password: 'errada123' });
    const unknownEmail = await request(app).post('/api/auth/login').send({ email: uniqueEmail(), password: 'errada123' });
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body.message).toBe(unknownEmail.body.message);
  });
});

describe('GET /api/auth/me', () => {
  it('requires a bearer token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns the current user for a valid token', async () => {
    const email = uniqueEmail();
    const reg = await request(app).post('/api/auth/register').send({ nome: 'Ana', email, password: 'senha123', companyName: 'Ana Ltda', role: 'sacado' });
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${reg.body.token}`);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(email.toLowerCase());
  });

  it('rejects a garbage token', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/refresh', () => {
  it('exchanges a valid refresh token for a new token pair, rotating the old one out', async () => {
    const email = uniqueEmail();
    const reg = await request(app).post('/api/auth/register').send({ nome: 'Ana', email, password: 'senha123', companyName: 'Ana Ltda', role: 'cedente' });
    const oldRefreshToken = reg.body.refreshToken as string;
    expect(oldRefreshToken).toBeTypeOf('string');

    const res = await request(app).post('/api/auth/refresh').send({ refreshToken: oldRefreshToken });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTypeOf('string');
    expect(res.body.refreshToken).not.toBe(oldRefreshToken);

    // the rotated-out token is single-use
    const reused = await request(app).post('/api/auth/refresh').send({ refreshToken: oldRefreshToken });
    expect(reused.status).toBe(401);
  });

  it('rejects an unknown refresh token', async () => {
    const res = await request(app).post('/api/auth/refresh').send({ refreshToken: 'not-a-real-refresh-token' });
    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/logout', () => {
  it('revokes the refresh token so it can no longer be used', async () => {
    const email = uniqueEmail();
    const reg = await request(app).post('/api/auth/register').send({ nome: 'Ana', email, password: 'senha123', companyName: 'Ana Ltda', role: 'cedente' });
    const { token, refreshToken } = reg.body;

    const logout = await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${token}`).send({ refreshToken });
    expect(logout.status).toBe(200);

    const res = await request(app).post('/api/auth/refresh').send({ refreshToken });
    expect(res.status).toBe(401);
  });
});
