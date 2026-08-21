import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { approveKyb, updateSettings, updateSubscription } from '../src/db/users.js';
import { marketMakerAgent } from '../src/lib/agents/marketMaker.js';
import { runMarketMakerAgentScan } from '../src/lib/marketMakerAgentJob.js';
import type { AgentRunContext } from '../src/lib/agentRuntime.js';

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function registerInvestidor() {
  const email = `inv-mm-${unique()}@example.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Investidor', email, password: 'senha123', companyName: `Fundo ${unique()}`, role: 'investidor' });
  approveKyb(res.body.user.id);
  return { token: res.body.token as string, userId: res.body.user.id as number };
}

function parseDataBr(value: string): Date {
  const [d, m, y] = value.split('/');
  return new Date(`${y}-${m}-${d}`);
}

async function sellerWithListing(askingValor: string) {
  const seller = await registerInvestidor();
  const market = await request(app).get('/api/market').set('Authorization', `Bearer ${seller.token}`);
  const buyable = market.body.offers.find((o: { canBuy: boolean; vencimento: string }) => o.canBuy && parseDataBr(o.vencimento).getTime() > Date.now());
  await request(app).post(`/api/market/${buyable.id}/buy`).set('Authorization', `Bearer ${seller.token}`);
  const secundario = await request(app).get('/api/secundario').set('Authorization', `Bearer ${seller.token}`);
  const position = secundario.body.minhasPosicoes.find((p: { duplicataId: string }) => p.duplicataId === buyable.id);
  const listRes = await request(app)
    .post('/api/secundario/listar')
    .set('Authorization', `Bearer ${seller.token}`)
    .send({ purchaseId: position.purchaseId, askingValor });
  const listing = listRes.body.market.find((l: { duplicataId: string }) => l.duplicataId === buyable.id);
  return { seller, duplicataId: buyable.id as string, listingId: listing.id as number };
}

function tool(name: string) {
  const t = marketMakerAgent.tools.find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} not found`);
  return t;
}

describe('Market Maker agent — registry shape', () => {
  it('is self-service for investidor, and its only write tool is sensitive/self-approvable', () => {
    expect(marketMakerAgent.selfServiceRoles).toEqual(['investidor']);
    const write = tool('dar_lance_liquidez');
    expect(write.sensitive).toBe(true);
    expect(write.selfApprovable).toBe(true);
  });

  it("never exposes a userId parameter on its sensitive tool — the acting account always comes from context", () => {
    const write = tool('dar_lance_liquidez');
    const props = (write.inputSchema as { properties: Record<string, unknown> }).properties;
    expect(Object.keys(props)).not.toContain('userId');
  });
});

describe('Market Maker agent — tool handlers (direct, bypassing the LLM loop)', () => {
  function ctxFor(userId: number): AgentRunContext {
    return { runId: -1, userId };
  }

  it('lists listings with no active bid, excluding the caller\'s own', async () => {
    const { listingId, seller } = await sellerWithListing('50.000');
    const mm = await registerInvestidor();

    const listed = (await tool('listar_anuncios_sem_lance').handler({}, ctxFor(mm.userId))) as { listingId: number }[];
    expect(listed.some((l) => l.listingId === listingId)).toBe(true);

    const ownView = (await tool('listar_anuncios_sem_lance').handler({}, ctxFor(seller.userId))) as { listingId: number }[];
    expect(ownView.some((l) => l.listingId === listingId)).toBe(false);
  });

  it('suggests a fair bid that never exceeds the asking price', async () => {
    const { listingId } = await sellerWithListing('50.000');
    const suggestion = (await tool('calcular_lance_justo').handler({ listingId }, ctxFor(1))) as { lanceSugerido: number };
    expect(suggestion.lanceSugerido).toBeGreaterThan(0);
    expect(suggestion.lanceSugerido).toBeLessThanOrEqual(50000);
  });

  it('reports configured rules and available capacity from the investor\'s own settings', async () => {
    const mm = await registerInvestidor();
    updateSettings(mm.userId, { marketMakerEnabled: true, marketMakerMaxExposicao: '30.000', marketMakerMinScore: '50' });

    const rules = (await tool('ver_minhas_regras_de_liquidez').handler({}, ctxFor(mm.userId))) as { marketMakerEnabled: boolean; scoreMinimo: number; exposicaoMaxima: number };
    expect(rules.marketMakerEnabled).toBe(true);
    expect(rules.scoreMinimo).toBe(50);
    expect(rules.exposicaoMaxima).toBe(30000);

    const capacity = (await tool('ver_minha_capacidade_disponivel').handler({}, ctxFor(mm.userId))) as { disponivel: number };
    expect(capacity.disponivel).toBe(30000);
  });

  it('places a real bid via dar_lance_liquidez, always as ctx.userId regardless of any userId the caller might try to smuggle into the tool input', async () => {
    const { listingId } = await sellerWithListing('50.000');
    const mm = await registerInvestidor();
    const other = await registerInvestidor();

    // Even if a userId were present in the raw input object (not part of the declared
    // schema, but nothing stops a malformed call from including one), the handler ignores
    // it — the bid is always placed for ctx.userId.
    const result = (await tool('dar_lance_liquidez').handler({ listingId, valor: 40000, userId: other.userId } as never, ctxFor(mm.userId))) as { ok: boolean };
    expect(result.ok).toBe(true);

    const mmView = await request(app).get('/api/secundario').set('Authorization', `Bearer ${mm.token}`);
    expect(mmView.body.meusLances.some((b: { listingId: number; valorFmt: string }) => b.listingId === listingId)).toBe(true);
    const otherView = await request(app).get('/api/secundario').set('Authorization', `Bearer ${other.token}`);
    expect(otherView.body.meusLances.some((b: { listingId: number }) => b.listingId === listingId)).toBe(false);
  });

  it('capacity reflects a real committed bid after dar_lance_liquidez runs', async () => {
    const { listingId } = await sellerWithListing('20.000');
    const mm = await registerInvestidor();
    updateSettings(mm.userId, { marketMakerMaxExposicao: '100.000' });
    await tool('dar_lance_liquidez').handler({ listingId, valor: 15000 }, ctxFor(mm.userId));
    const capacity = (await tool('ver_minha_capacidade_disponivel').handler({}, ctxFor(mm.userId))) as { comprometidoFmt: string; disponivel: number };
    expect(capacity.disponivel).toBe(85000);
  });
});

describe('Market Maker agent — self-service HTTP access', () => {
  it('is exposed to investidor accounts via GET /agents, alongside autobid', async () => {
    const inv = await registerInvestidor();
    const res = await request(app).get('/api/agents').set('Authorization', `Bearer ${inv.token}`);
    expect(res.body.agents.map((a: { id: string }) => a.id)).toContain('market_maker');
  });
});

describe('Market Maker rules — Automação de Lances routes', () => {
  it('toggles marketMakerEnabled and updates the exposure/score rules', async () => {
    const inv = await registerInvestidor();
    // Automação de Lances (and every route in routes/automation.ts, this one included) is
    // gated behind the Pro plan — same requirePlan('pro') check billing.test.ts exercises.
    updateSubscription(inv.userId, { plan: 'pro', subscriptionStatus: 'active' });
    const toggled = await request(app).post('/api/automacao/market-maker/toggle').set('Authorization', `Bearer ${inv.token}`);
    expect(toggled.status).toBe(200);
    expect(toggled.body.marketMakerEnabled).toBe(true);

    const ruled = await request(app)
      .post('/api/automacao/market-maker/rule')
      .set('Authorization', `Bearer ${inv.token}`)
      .send({ field: 'marketMakerMaxExposicao', value: '500.000' });
    expect(ruled.status).toBe(200);
    expect(ruled.body.marketMakerMaxExposicao).toBe('500.000');

    const view = await request(app).get('/api/automacao').set('Authorization', `Bearer ${inv.token}`);
    expect(view.body.marketMakerEnabled).toBe(true);
    expect(view.body.marketMakerMaxExposicao).toBe('500.000');
  });
});

describe('Market Maker background job — honest no-op without ANTHROPIC_API_KEY', () => {
  it('never fakes a scan (no test env sets ANTHROPIC_API_KEY)', async () => {
    const result = await runMarketMakerAgentScan();
    expect(result).toEqual({ scanned: 0, newPendingActions: 0 });
  });
});
