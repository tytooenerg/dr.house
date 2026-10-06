import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { credenciarInvestidor } from './helpers/investidor.js';
import { updateSubscription } from '../src/db/users.js';

// Regressão: AutomacaoPage.tsx mostrava "Ativo — dando lances..." baseado só no toggle
// POR CONTA (settings.marketMakerEnabled), sem saber que lib/marketMakerAgentJob.ts vira
// um no-op quando o admin desliga o kill switch GLOBAL ('market_maker_agent',
// lib/featureFlags.ts) — exatamente o cenário em que o flag existe pra ser usado (conter
// uma instabilidade de mercado). GET /automacao agora também expõe
// marketMakerGloballyEnabled, refletindo o estado real do flag.

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

async function setMarketMakerFlag(enabled: boolean) {
  const adminToken = await loginAdmin();
  const res = await request(app)
    .post('/api/admin/feature-flags/market_maker_agent')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ enabled, rolloutPct: 100 });
  expect(res.status).toBe(200);
}

async function registerInvestidor() {
  const email = `inv-mmstatus-${unique()}@example.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Investidor', email, password: 'senha123', companyName: `Fundo ${unique()}`, role: 'investidor' });
  credenciarInvestidor(res.body.user.id);
  updateSubscription(res.body.user.id, { plan: 'pro', subscriptionStatus: 'active' });
  return res.body.token as string;
}

describe('GET /automacao expõe o estado real do kill switch global do Market Maker', () => {
  it('ligado por padrão: marketMakerGloballyEnabled vem true', async () => {
    const token = await registerInvestidor();
    const res = await request(app).get('/api/automacao').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.marketMakerGloballyEnabled).toBe(true);
  });

  it('admin desliga o flag: marketMakerGloballyEnabled vem false mesmo com o toggle da conta ligado', async () => {
    const token = await registerInvestidor();
    await request(app).post('/api/automacao/market-maker/toggle').set('Authorization', `Bearer ${token}`);
    const before = await request(app).get('/api/automacao').set('Authorization', `Bearer ${token}`);
    expect(before.body.marketMakerEnabled).toBe(true);

    await setMarketMakerFlag(false);
    try {
      const res = await request(app).get('/api/automacao').set('Authorization', `Bearer ${token}`);
      expect(res.body.marketMakerEnabled).toBe(true);
      expect(res.body.marketMakerGloballyEnabled).toBe(false);
    } finally {
      await setMarketMakerFlag(true);
    }
  });
});
