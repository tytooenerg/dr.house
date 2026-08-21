import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function registerApiPartner() {
  const res = await request(app).post('/api/auth/register').send({
    nome: 'Parceiro API',
    email: `api-partner-${unique()}@example.com`,
    password: 'senha123',
    companyName: `Fintech Parceira ${unique()} Ltda`,
    role: 'api_partner',
  });
  return res;
}

describe('api_partner role — Score/PLD API como produto standalone', () => {
  it('registers without needing KYB, with only dev/conta/perfil tabs', async () => {
    const res = await registerApiPartner();
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('api_partner');
    expect(res.body.user.needsKyb).toBe(false);
    expect(res.body.user.navTabs.sort()).toEqual(['conta', 'dev', 'perfil']);
    expect(res.body.user.sessionLabel).toBe('Acesso via API');
  });

  it('can generate a Score API key without any plan upgrade', async () => {
    const reg = await registerApiPartner();
    const token = reg.body.token as string;
    const res = await request(app).post('/api/dev/keys/generate').set('Authorization', `Bearer ${token}`).send({ product: 'score_api', mode: 'live' });
    expect(res.status).toBe(200);
    expect(res.body.rawKey).toMatch(/^lastro_/);
    expect(res.body.apiKeys.some((k: { product: string }) => k.product === 'score_api')).toBe(true);
  });

  it('can generate a PLD Screening API key without any plan upgrade', async () => {
    const reg = await registerApiPartner();
    const token = reg.body.token as string;
    const res = await request(app).post('/api/dev/keys/generate').set('Authorization', `Bearer ${token}`).send({ product: 'pld_screening_api', mode: 'live' });
    expect(res.status).toBe(200);
    expect(res.body.apiKeys.some((k: { product: string }) => k.product === 'pld_screening_api')).toBe(true);
  });

  it('is refused a full-platform key even if it tries — that guarantee is server-side, not just hidden in the UI', async () => {
    const reg = await registerApiPartner();
    const token = reg.body.token as string;
    const res = await request(app).post('/api/dev/keys/generate').set('Authorization', `Bearer ${token}`).send({ product: 'platform', mode: 'test' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('role_not_allowed');
  });
});
