import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { approveKyb } from '../src/db/users.js';
import { createDuplicata, createPurchase } from '../src/db/duplicatas.js';
import { db } from '../src/db/index.js';

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function registerInvestidor() {
  const email = `inv-rebal-${unique()}@example.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Investidor', email, password: 'senha123', companyName: `Fundo ${unique()}`, role: 'investidor' });
  approveKyb(res.body.user.id);
  return { token: res.body.token as string, userId: res.body.user.id as number };
}

// Real sacados from data/seed.ts's SACADOS registry with known, deterministic
// scores/ratings — same lookup lib/portfolioRebalance.ts's ratingFromScore uses.
const SACADO_BY_RATING = {
  AA: 'Grupo Atlas Varejo',
  A: 'Distribuidora Bom Preço',
  B: 'Metalúrgica Serrana S.A.',
  C: 'Construtora Vale Norte',
};

function buyPosition(investorId: number, rating: keyof typeof SACADO_BY_RATING, valor: number) {
  const d = createDuplicata({
    cedenteId: null,
    cedenteNome: 'Cedente Teste',
    sacadoNome: SACADO_BY_RATING[rating],
    sacadoCnpj: '',
    valor,
    vencimento: '2026-12-31',
    emissao: '10/08/2026',
    status: 'aprovada',
    lastroPct: 100,
    seguro: false,
  });
  createPurchase(d.id, investorId, valor, '2,0%');
  return d.id;
}

// For portfolio-composition tests that need multiple *distinct* sacado names within the
// same rating band (so the single-name concentration limit isn't itself the only thing
// being exercised) — data/seed.ts's SACADOS registry only has one name per band, so this
// creates an unlisted sacado name (score defaults to null via db/duplicatas.ts's scoreFor)
// and sets its real score directly at the DB layer, exactly as an unlisted-but-real sacado
// would eventually get one from lib/riscoCore.ts's own scoring, not a fabricated shortcut
// around it.
function buyPositionWithScore(investorId: number, sacadoName: string, score: number, valor: number) {
  const d = createDuplicata({
    cedenteId: null,
    cedenteNome: 'Cedente Teste',
    sacadoNome: sacadoName,
    sacadoCnpj: '',
    valor,
    vencimento: '2026-12-31',
    emissao: '10/08/2026',
    status: 'aprovada',
    lastroPct: 100,
    seguro: false,
  });
  db.prepare('UPDATE duplicatas SET score = ? WHERE id = ?').run(score, d.id);
  createPurchase(d.id, investorId, valor, '2,0%');
  return d.id;
}

describe('Portfolio rebalance — degenerate/empty portfolio', () => {
  it('returns zero totals and no suggestions for an investor with no purchases', async () => {
    const { token } = await registerInvestidor();
    const res = await request(app).get('/api/historico/rebalanceamento').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.totalInvestidoFmt).toContain('0');
    expect(res.body.posicoesAtivas).toBe(0);
    expect(res.body.suggestions).toEqual([]);
    expect(res.body.usingDefaultProfile).toBe(true);
    expect(res.body.profile).toBe('moderado');
  });
});

describe('Portfolio rebalance — real drift and concentration suggestions', () => {
  it('flags both rating drift and single-sacado concentration for a 100% C-rated portfolio', async () => {
    const { token, userId } = await registerInvestidor();
    buyPosition(userId, 'C', 100000);

    const res = await request(app).get('/api/historico/rebalanceamento').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.posicoesAtivas).toBe(1);

    const cRow = res.body.ratingComparison.find((r: { rating: string }) => r.rating === 'C');
    expect(cRow.actualPct).toBe(100);
    expect(cRow.targetPct).toBe(5); // moderado default profile

    expect(res.body.suggestions.some((s: { type: string }) => s.type === 'reduzir_rating')).toBe(true);
    expect(res.body.suggestions.some((s: { type: string }) => s.type === 'reduzir_concentracao_sacado')).toBe(true);

    const concentration = res.body.sacadoConcentration.find((c: { sacado: string }) => c.sacado === 'Construtora Vale Norte');
    expect(concentration.pct).toBe(100);
    expect(concentration.overLimit).toBe(true);
  });

  it('a well-diversified portfolio close to the target bands produces no suggestions', async () => {
    const { token, userId } = await registerInvestidor();
    // moderado target: AA 35 / A 40 / B 20 / C 5. AA and A alone exceed the 25%
    // single-sacado concentration limit, so each is split across two distinct sacado
    // names to stay diversified on both axes at once — a real institutional portfolio
    // would do the same rather than concentrate 35% in one counterparty.
    buyPositionWithScore(userId, 'AA Corp 1', 84, 17500);
    buyPositionWithScore(userId, 'AA Corp 2', 84, 17500);
    buyPositionWithScore(userId, 'A Corp 1', 76, 20000);
    buyPositionWithScore(userId, 'A Corp 2', 76, 20000);
    buyPosition(userId, 'B', 20000);
    buyPosition(userId, 'C', 5000);

    const res = await request(app).get('/api/historico/rebalanceamento').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.suggestions).toEqual([]);
  });

  it('the target bands and profile shift once a real suitability assessment is on file', async () => {
    const { token, userId } = await registerInvestidor();
    buyPosition(userId, 'B', 100000);

    await request(app)
      .post('/api/suitability/submit')
      .set('Authorization', `Bearer ${token}`)
      .send({
        answers: {
          objetivo: 'preservar',
          horizonte: 'curto',
          tolerancia_perda: 'resgataria',
          experiencia: 'nenhuma',
          concentracao: 'alta',
          renda: 'instavel',
        },
      });

    const res = await request(app).get('/api/historico/rebalanceamento').set('Authorization', `Bearer ${token}`);
    expect(res.body.usingDefaultProfile).toBe(false);
    expect(res.body.profile).toBe('conservador');
    const bRow = res.body.ratingComparison.find((r: { rating: string }) => r.rating === 'B');
    expect(bRow.targetPct).toBe(0); // conservador allocates 0% to B — every real B position now drifts
    expect(res.body.suggestions.some((s: { type: string }) => s.type === 'reduzir_rating')).toBe(true);
  });
});
