import { describe, expect, it, beforeAll, vi } from 'vitest';
import request from 'supertest';

// Same reasoning as billing-webhook.test.ts: the rate limiter reads its limit from
// process.env once at module-load time, and static imports are hoisted above any
// top-level env stubbing in this file — so we stub first, then dynamically import.
let app: import('express').Express;

beforeAll(async () => {
  vi.stubEnv('API_RATE_LIMIT_PER_MIN', '3');
  const appModule = await import('../src/app.js');
  app = appModule.app;
  const seedModule = await import('../src/db/seed.js');
  await seedModule.seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

describe('partner API rate limiting', () => {
  it('returns 429 once a key exceeds its per-minute budget', async () => {
    const email = `ced-rl-${unique()}@example.com`;
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ nome: 'Cedente RL', email, password: 'senha123', companyName: `Cedente RL ${unique()}`, role: 'cedente' });
    const token = reg.body.token as string;
    await request(app).post('/api/billing/checkout').set('Authorization', `Bearer ${token}`).send({ plan: 'empresarial' });
    const genRes = await request(app).post('/api/dev/keys/generate').set('Authorization', `Bearer ${token}`);
    const rawKey = genRes.body.rawKey as string;

    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await request(app).get('/api/v1/marketplace').set('Authorization', `Bearer ${rawKey}`);
      statuses.push(res.status);
    }

    expect(statuses.slice(0, 3)).toEqual([200, 200, 200]);
    expect(statuses[3]).toBe(429);
  });
});
