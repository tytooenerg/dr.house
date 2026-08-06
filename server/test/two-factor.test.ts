import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { generateTotpSecret, totpAt, verifyTotp } from '../src/lib/totp.js';

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function registerUser() {
  const email = `2fa-${unique()}@example.com`;
  const res = await request(app).post('/api/auth/register').send({
    nome: 'Usuária 2FA',
    email,
    password: 'senha123',
    companyName: `Empresa 2FA ${unique()} Ltda`,
    role: 'cedente',
  });
  return { token: res.body.token as string, email };
}

describe('TOTP algorithm (lib/totp.ts)', () => {
  it('verifies a code generated for the current time window and rejects a wrong one', () => {
    const secret = generateTotpSecret();
    const code = totpAt(secret);
    expect(verifyTotp(secret, code)).toBe(true);
    const wrongCode = code === '000000' ? '000001' : '000000';
    expect(verifyTotp(secret, wrongCode)).toBe(false);
  });

  it('rejects malformed input without throwing', () => {
    const secret = generateTotpSecret();
    expect(verifyTotp(secret, 'abcdef')).toBe(false);
    expect(verifyTotp(secret, '123')).toBe(false);
    expect(verifyTotp(secret, '')).toBe(false);
  });
});

describe('Real TOTP-based 2FA', () => {
  it('full setup → confirm → login-with-code → disable lifecycle', async () => {
    const { token, email } = await registerUser();

    // Before enabling, login is a normal single-step flow.
    const plainLogin = await request(app).post('/api/auth/login').send({ email, password: 'senha123' });
    expect(plainLogin.status).toBe(200);
    expect(plainLogin.body.twoFactorRequired).toBeFalsy();

    const setup = await request(app).post('/api/auth/2fa/setup').set('Authorization', `Bearer ${token}`);
    expect(setup.status).toBe(200);
    expect(setup.body.secret).toBeTruthy();
    expect(setup.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
    const secret = setup.body.secret as string;

    // A wrong code doesn't enable it.
    const badConfirm = await request(app).post('/api/auth/2fa/confirm').set('Authorization', `Bearer ${token}`).send({ code: '000000' });
    expect(badConfirm.status).toBe(400);

    const confirm = await request(app).post('/api/auth/2fa/confirm').set('Authorization', `Bearer ${token}`).send({ code: totpAt(secret) });
    expect(confirm.status).toBe(200);
    expect(confirm.body.recoveryCodes).toHaveLength(8);
    const recoveryCode = confirm.body.recoveryCodes[0] as string;

    const status = await request(app).get('/api/auth/2fa/status').set('Authorization', `Bearer ${token}`);
    expect(status.body.enabled).toBe(true);
    expect(status.body.remainingRecoveryCodes).toBe(8);

    // Login now requires the second step — no session tokens are handed out yet.
    const login = await request(app).post('/api/auth/login').send({ email, password: 'senha123' });
    expect(login.status).toBe(200);
    expect(login.body.twoFactorRequired).toBe(true);
    expect(login.body.token).toBeUndefined();
    const challengeToken = login.body.challengeToken as string;

    // The challenge token itself grants no API access.
    const misuse = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${challengeToken}`);
    expect(misuse.status).toBe(401);

    const wrongCode = await request(app).post('/api/auth/2fa/verify-login').send({ challengeToken, code: '000000' });
    expect(wrongCode.status).toBe(401);

    const verify = await request(app).post('/api/auth/2fa/verify-login').send({ challengeToken, code: totpAt(secret) });
    expect(verify.status).toBe(200);
    expect(verify.body.token).toBeTruthy();
    expect(verify.body.user.totpEnabled).toBe(true);

    // Recovery code works as a one-shot alternative, then can't be reused.
    const login2 = await request(app).post('/api/auth/login').send({ email, password: 'senha123' });
    const challenge2 = login2.body.challengeToken as string;
    const recoveryVerify = await request(app).post('/api/auth/2fa/verify-login').send({ challengeToken: challenge2, code: recoveryCode });
    expect(recoveryVerify.status).toBe(200);

    const login3 = await request(app).post('/api/auth/login').send({ email, password: 'senha123' });
    const challenge3 = login3.body.challengeToken as string;
    const recoveryReuse = await request(app).post('/api/auth/2fa/verify-login').send({ challengeToken: challenge3, code: recoveryCode });
    expect(recoveryReuse.status).toBe(401);

    // Disabling requires the account password.
    const disableWrongPw = await request(app).post('/api/auth/2fa/disable').set('Authorization', `Bearer ${verify.body.token}`).send({ password: 'errada' });
    expect(disableWrongPw.status).toBe(401);

    const disable = await request(app).post('/api/auth/2fa/disable').set('Authorization', `Bearer ${verify.body.token}`).send({ password: 'senha123' });
    expect(disable.status).toBe(200);

    const loginAfterDisable = await request(app).post('/api/auth/login').send({ email, password: 'senha123' });
    expect(loginAfterDisable.status).toBe(200);
    expect(loginAfterDisable.body.twoFactorRequired).toBeFalsy();
    expect(loginAfterDisable.body.token).toBeTruthy();
  });
});
