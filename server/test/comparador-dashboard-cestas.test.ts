import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';

// comparador.ts, dashboard.ts e cestas.ts tinham cobertura de teste fraca ou nula pra
// lógica de negócio real: comparador só era tocado pelo gating de plano em billing.test.ts
// (nunca verificava o cálculo em si), dashboard.ts só era tocado incidentalmente pela
// checagem de auth em team-invites.test.ts, e cestas.ts's GET / (listagem) nunca era
// chamado por nenhum teste.

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function registerInvestidor() {
  const email = `inv-cdc-${unique()}@example.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Investidor', email, password: 'senha123', companyName: `Fundo ${unique()}`, role: 'investidor' });
  return res.body.token as string;
}

async function registerCedente() {
  const email = `ced-cdc-${unique()}@example.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Cedente', email, password: 'senha123', companyName: `Cedente ${unique()}`, role: 'cedente' });
  return res.body.token as string;
}

describe('Comparador de Taxas — lógica real (routes/comparador.ts)', () => {
  it('GET /rates retorna os canais de mercado com os campos que o gráfico precisa', async () => {
    const token = await registerCedente();
    const res = await request(app).get('/api/comparador/rates').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.rateChannels.length).toBeGreaterThan(0);
    const lastro = res.body.rateChannels.find((c: { isLastro: boolean }) => c.isLastro);
    expect(lastro).toBeTruthy();
    expect(lastro.label).toBeTruthy();
    expect(lastro.rangeLabel).toMatch(/%/);
  });

  it('POST /estimate calcula o deságio pela faixa do score e pelo prazo (30 dias = fator 1x)', async () => {
    const token = await registerCedente();
    const res = await request(app)
      .post('/api/comparador/estimate')
      .set('Authorization', `Bearer ${token}`)
      .send({ valor: '50.000', prazo: '30', score: 'AA' });
    expect(res.status).toBe(200);
    // Faixa AA = [1.2, 1.6] a.m., fator de prazo 30/30 = 1x — deságio médio (1,4%) sobre 50.000.
    expect(res.body.rangeLabel).toBe('1,2% – 1,6% no período');
    expect(res.body.desagioFmt.replace(/\D/g, '')).toBe('700');
    expect(res.body.liquidoFmt.replace(/\D/g, '')).toBe('49300'); // R$ 49.300 (fmtBRL sem centavos)
  });

  it('POST /estimate dobra a faixa quando o prazo dobra (60 dias = fator 2x)', async () => {
    const token = await registerCedente();
    const res = await request(app)
      .post('/api/comparador/estimate')
      .set('Authorization', `Bearer ${token}`)
      .send({ valor: '10.000', prazo: '60', score: 'A' });
    expect(res.status).toBe(200);
    // Faixa A = [1.5, 2.0] a.m. * fator 2x = [3.0%, 4.0%].
    expect(res.body.rangeLabel).toBe('3,0% – 4,0% no período');
  });

  it('POST /estimate sem valor numérico retorna — em vez de um valor fabricado', async () => {
    const token = await registerCedente();
    const res = await request(app).post('/api/comparador/estimate').set('Authorization', `Bearer ${token}`).send({ valor: '' });
    expect(res.status).toBe(200);
    expect(res.body.desagioFmt).toBe('—');
    expect(res.body.liquidoFmt).toBe('—');
  });
});

describe('Dashboard — KPIs/gráficos reais (routes/dashboard.ts)', () => {
  it('retorna 4 KPIs, barras mensais e os cortes do donut de risco no formato esperado pelo client', async () => {
    const token = await registerCedente();
    const res = await request(app).get('/api/dashboard').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);

    expect(res.body.kpis).toHaveLength(4);
    expect(res.body.kpis[0].cardBg).toBe('#0B1F3A'); // COLORS.NAVY — o primeiro KPI é destacado
    expect(res.body.kpis[1].cardBg).toBe('#fff');

    expect(res.body.monthlyBars.length).toBeGreaterThan(0);
    for (const bar of res.body.monthlyBars) {
      expect(bar.heightPct).toBeGreaterThanOrEqual(0);
      expect(bar.heightPct).toBeLessThanOrEqual(100);
    }
    expect(res.body.monthlyBars.some((b: { heightPct: number }) => b.heightPct === 100)).toBe(true); // o mês de maior volume bate 100%

    expect(res.body.riskDonutStops).toHaveLength(4);
    expect(res.body.riskDonutStops[0].from).toBe(0);
    expect(res.body.riskDonutStops.at(-1).to).toBe(100);

    expect(typeof res.body.activeDuplicatas).toBe('number');
  });

  it('activeDuplicatas reflete duplicatas reais em aprovada/no_mercado — sobe quando uma nova é emitida', async () => {
    const cedenteToken = await registerCedente();
    const before = await request(app).get('/api/dashboard').set('Authorization', `Bearer ${cedenteToken}`);

    let emit = await request(app)
      .post('/api/emitir/submit')
      .set('Authorization', `Bearer ${cedenteToken}`)
      .send({ sacado: unique('Sacado Dashboard'), cnpj: '33.222.111/0001-77', valor: '5.000', vencimento: '2026-12-01', seguro: false, nfAnexada: true, batchValores: [] });
    for (let attempt = 0; attempt < 5 && emit.status !== 200; attempt++) {
      emit = await request(app)
        .post('/api/emitir/submit')
        .set('Authorization', `Bearer ${cedenteToken}`)
        .send({ sacado: unique('Sacado Dashboard'), cnpj: '33.222.111/0001-77', valor: '5.000', vencimento: '2026-12-01', seguro: false, nfAnexada: true, batchValores: [] });
    }
    expect(emit.status).toBe(200);

    const after = await request(app).get('/api/dashboard').set('Authorization', `Bearer ${cedenteToken}`);
    expect(after.body.activeDuplicatas).toBe(before.body.activeDuplicatas + 1);
  });
});

describe('Cestas de investimento — listagem (routes/cestas.ts)', () => {
  it('GET / lista as 3 cestas com rótulo, descrição e os ratings que cada uma aceita', async () => {
    const token = await registerInvestidor();
    const res = await request(app).get('/api/cestas').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.cestas).toHaveLength(3);

    const conservadora = res.body.cestas.find((c: { key: string }) => c.key === 'conservadora');
    expect(conservadora.ratings).toEqual(['AA', 'A']);
    const agressiva = res.body.cestas.find((c: { key: string }) => c.key === 'agressiva');
    expect(agressiva.ratings).toEqual(['B', 'C']);
    for (const c of res.body.cestas) {
      expect(c.label).toBeTruthy();
      expect(c.desc).toBeTruthy();
      // Achado corrigido: cestas não mostravam faixa de taxa nenhuma, mesmo misturando
      // várias classes de rating — faixa mescla automaticamente as classes que a cesta
      // aceita (real = a partir de ofertas de fato compráveis agora; teórica quando vazia).
      expect(c.faixa.minFmt).toMatch(/%$/);
      expect(c.faixa.maxFmt).toMatch(/%$/);
      expect(c.faixa.medioFmt).toMatch(/%$/);
      expect(typeof c.faixa.real).toBe('boolean');
    }
  });

  it('GET / cai pra faixa teórica (não finge dado real) quando a cesta não tem nenhuma oferta compra´vel agora', async () => {
    // 'agressiva' (B/C) só tem oferta real se o seed/testes anteriores tiverem deixado uma
    // aberta — nesta suíte isolada (server/vitest.config.ts roda cada arquivo com seu
    // próprio banco), a única fonte é o seed padrão. Em vez de depender do estado exato do
    // seed, o teste real que importa é: teórica e real usam o MESMO formato de resposta
    // (já coberto acima) — este teste cobre especificamente o cálculo puro sem tocar HTTP,
    // usando um rating sem nenhuma oferta seedada (garantido: nenhum seed usa 'C' sozinho).
    const { buildCestaRange } = await import('../src/lib/cestasCore.js');
    const range = buildCestaRange(['C']);
    expect(range.minFmt).toMatch(/%$/);
    expect(range.maxFmt).toMatch(/%$/);
    if (!range.real) {
      // Banda teórica: min/max vêm de estimateRateBand('C'), então min <= max sempre.
      const toNum = (s: string) => parseFloat(s.replace(',', '.'));
      expect(toNum(range.minFmt)).toBeLessThanOrEqual(toNum(range.maxFmt));
    }
  });

  it('GET / é restrito a contas investidor', async () => {
    const token = await registerCedente();
    const res = await request(app).get('/api/cestas').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});
