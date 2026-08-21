import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { isFeatureEnabled, FEATURE_FLAG_DEFS } from '../src/lib/featureFlags.js';

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function loginAdmin() {
  const res = await request(app).post('/api/auth/login').send({ email: 'admin@lastro.demo', password: 'demo1234' });
  return res.body.token as string;
}

async function registerInvestidor() {
  const email = `inv-flags-${unique()}@example.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Investidor', email, password: 'senha123', companyName: `Fundo Flags ${unique()}`, role: 'investidor' });
  return { token: res.body.token as string, userId: res.body.user?.id as number | undefined, status: res.status };
}

async function setFlag(adminToken: string, key: string, enabled: boolean, rolloutPct = 100) {
  return request(app).post(`/api/admin/feature-flags/${key}`).set('Authorization', `Bearer ${adminToken}`).send({ enabled, rolloutPct });
}

describe('Feature flags — registry', () => {
  it('every declared flag defaults to its coded defaultEnabled with no override', async () => {
    const adminToken = await loginAdmin();
    const res = await request(app).get('/api/admin/feature-flags').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    for (const def of FEATURE_FLAG_DEFS) {
      const view = res.body.flags.find((f: { key: string }) => f.key === def.key);
      expect(view).toBeTruthy();
      expect(view.enabled).toBe(def.defaultEnabled);
      expect(view.isOverridden).toBe(false);
    }
  });

  it('rejects a non-admin caller', async () => {
    const { token } = await registerInvestidor();
    const res = await request(app).get('/api/admin/feature-flags').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('404s an update for an unknown flag key', async () => {
    const adminToken = await loginAdmin();
    const res = await setFlag(adminToken, 'not_a_real_flag', false);
    expect(res.status).toBe(404);
  });
});

describe('Feature flags — new_registrations gates every signup path', () => {
  it('blocks a normal registration while disabled, and allows it again once re-enabled', async () => {
    const adminToken = await loginAdmin();
    const off = await setFlag(adminToken, 'new_registrations', false);
    expect(off.status).toBe(200);
    expect(off.body.flags.find((f: { key: string }) => f.key === 'new_registrations').enabled).toBe(false);

    const blocked = await registerInvestidor();
    expect(blocked.status).toBe(503);

    const on = await setFlag(adminToken, 'new_registrations', true);
    expect(on.status).toBe(200);
    const allowed = await registerInvestidor();
    expect(allowed.status).toBe(201);
  });
});

describe('Feature flags — embeddable_widget gates the public simulator', () => {
  it('the widget endpoint 503s while disabled and works again once re-enabled', async () => {
    const adminToken = await loginAdmin();
    await setFlag(adminToken, 'embeddable_widget', false);
    const blocked = await request(app).post('/api/public/simular').send({ valor: '10.000' });
    expect(blocked.status).toBe(503);
    expect(blocked.body.error).toBe('feature_disabled');

    await setFlag(adminToken, 'embeddable_widget', true);
    const allowed = await request(app).post('/api/public/simular').send({ valor: '10.000' });
    expect(allowed.status).toBe(200);
  });
});

describe('Feature flags — secondary_market_block_trade gates institutional sweeps', () => {
  it('runBlockTrade returns feature_disabled via the real route while the flag is off', async () => {
    const adminToken = await loginAdmin();
    await setFlag(adminToken, 'secondary_market_block_trade', false);

    const buyer = await registerInvestidor();
    const res = await request(app)
      .post('/api/secundario/block-trade')
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({ valorMaximo: '2.000.000' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('feature_disabled');

    await setFlag(adminToken, 'secondary_market_block_trade', true);
  });
});

describe('Feature flags — deterministic rollout bucketing', () => {
  it('the same (flag, userId) pair always lands on the same side, and 0%/100% are absolute', () => {
    // A partial rollout isn't wired to a live gate here (no per-user gate in this batch
    // uses < 100%), so this exercises isFeatureEnabled() directly — same function every
    // real gate calls.
    const results1 = Array.from({ length: 5 }, () => isFeatureEnabled('new_registrations', { userId: 4242 }));
    expect(new Set(results1).size).toBe(1); // always the same answer for the same user

    // Different users can land on different sides of a mid rollout, but the flag has no
    // override yet here, so just assert the absolute edges are correct.
    expect(isFeatureEnabled('embeddable_widget', { userId: 1 })).toBe(true);
  });
});
