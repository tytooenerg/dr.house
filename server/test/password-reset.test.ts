import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { getUserByEmail } from '../src/db/users.js';
import { signPasswordResetToken } from '../src/auth/jwt.js';

function uniqueEmail() {
  return `reset-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
}

async function registerUser(email: string, password = 'senha-antiga-123') {
  const res = await request(app).post('/api/auth/register').send({
    nome: 'Reset Teste',
    email,
    password,
    companyName: 'Reset Ltda',
    role: 'cedente',
  });
  expect(res.status).toBe(201);
  return res.body.token as string;
}

describe('POST /api/auth/forgot-password', () => {
  it('always responds ok, never revealing whether the e-mail exists', async () => {
    const email = uniqueEmail();
    await registerUser(email);

    const known = await request(app).post('/api/auth/forgot-password').send({ email });
    const unknown = await request(app).post('/api/auth/forgot-password').send({ email: uniqueEmail() });

    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(known.body.ok).toBe(true);
    expect(unknown.body.ok).toBe(true);
  });

  it('rejects an invalid e-mail format', async () => {
    const res = await request(app).post('/api/auth/forgot-password').send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
  });
});

describe('POST /api/auth/reset-password', () => {
  it('resets the password and logs the user in with a real token', async () => {
    const email = uniqueEmail();
    await registerUser(email, 'senha-antiga-123');
    const user = getUserByEmail(email)!;
    const token = signPasswordResetToken(user.id, user.password_hash);

    const res = await request(app).post('/api/auth/reset-password').send({ token, newPassword: 'senha-nova-456' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTypeOf('string');
    expect(res.body.user.email).toBe(email.toLowerCase());

    const loginOld = await request(app).post('/api/auth/login').send({ email, password: 'senha-antiga-123' });
    expect(loginOld.status).toBe(401);

    const loginNew = await request(app).post('/api/auth/login').send({ email, password: 'senha-nova-456' });
    expect(loginNew.status).toBe(200);
  });

  // Achado numa revisão de segurança: o reset trocava a senha e já logava a conta de
  // novo, mas nunca revogava os refresh tokens já emitidos — um refresh token roubado
  // ANTES do reset (o motivo mais comum de alguém pedir "esqueci minha senha" por
  // suspeita de invasão) continuaria renovando access tokens por até 30 dias depois,
  // sem o reset ter fechado nada. account.ts's /delete já seguia esse padrão
  // (revokeAllRefreshTokensForUser antes de concluir uma ação sensível) — reset-password
  // precisava do mesmo.
  it('revoga qualquer refresh token já emitido antes do reset', async () => {
    const email = uniqueEmail();
    await registerUser(email, 'senha-antiga-123');
    const login = await request(app).post('/api/auth/login').send({ email, password: 'senha-antiga-123' });
    const refreshTokenAntigo = login.body.refreshToken as string;
    expect(refreshTokenAntigo).toBeTypeOf('string');

    const user = getUserByEmail(email)!;
    const resetToken = signPasswordResetToken(user.id, user.password_hash);
    const reset = await request(app).post('/api/auth/reset-password').send({ token: resetToken, newPassword: 'senha-nova-456' });
    expect(reset.status).toBe(200);

    const tentativaComTokenAntigo = await request(app).post('/api/auth/refresh').send({ refreshToken: refreshTokenAntigo });
    expect(tentativaComTokenAntigo.status).toBe(401);
  });

  it('rejects a garbage token', async () => {
    const res = await request(app).post('/api/auth/reset-password').send({ token: 'nao-e-um-jwt-valido', newPassword: 'senha-nova-456' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_token');
  });

  it('rejects a token that was already used once (single-use via password-hash binding)', async () => {
    const email = uniqueEmail();
    await registerUser(email, 'senha-antiga-123');
    const user = getUserByEmail(email)!;
    const token = signPasswordResetToken(user.id, user.password_hash);

    const first = await request(app).post('/api/auth/reset-password').send({ token, newPassword: 'senha-nova-456' });
    expect(first.status).toBe(200);

    const second = await request(app).post('/api/auth/reset-password').send({ token, newPassword: 'outra-senha-789' });
    expect(second.status).toBe(400);
    expect(second.body.error).toBe('invalid_token');
  });

  it('rejects a new password shorter than 6 characters', async () => {
    const email = uniqueEmail();
    await registerUser(email);
    const user = getUserByEmail(email)!;
    const token = signPasswordResetToken(user.id, user.password_hash);

    const res = await request(app).post('/api/auth/reset-password').send({ token, newPassword: 'curta' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
  });
});
