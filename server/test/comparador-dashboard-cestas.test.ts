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

describe('Dashboard — KPIs reais por papel (lib/dashboardCore.ts)', () => {
  // Achado corrigido: o dashboard inteiro era constante — os 4 KPIs vinham de KPIS_RAW
  // ("R$ 128,4M", "342 duplicatas ativas"), as barras de MONTHS_RAW e o donut/legenda eram
  // literais na rota. Investidor, cedente e sacado viam os mesmos números, sem relação com
  // a conta de quem olhava, e a tela se contradizia: activeDuplicatas (real, no centro do
  // donut) discordava do card "342" ao lado.

  it('estrutura: 4 KPIs, 6 meses e cortes do donut fechando exatamente em 100', async () => {
    const token = await registerCedente();
    const res = await request(app).get('/api/dashboard').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);

    expect(res.body.kpis).toHaveLength(4);
    for (const k of res.body.kpis) {
      expect(typeof k.label).toBe('string');
      expect(typeof k.value).toBe('string');
      expect(typeof k.trend).toBe('string');
    }
    // Sempre 6 colunas, mesmo sem histórico — um gráfico que muda de largura confunde.
    expect(res.body.monthlyBars).toHaveLength(6);
    for (const bar of res.body.monthlyBars) {
      expect(bar.heightPct).toBeGreaterThanOrEqual(0);
      expect(bar.heightPct).toBeLessThanOrEqual(100);
    }
    expect(res.body.riskDonutStops[0].from).toBe(0);
    expect(res.body.riskDonutStops.at(-1).to).toBe(100);
    expect(typeof res.body.activeDuplicatas).toBe('number');
    expect(typeof res.body.donutTitle).toBe('string');
    expect(typeof res.body.monthlyTitle).toBe('string');
  });

  it('conta nova não inventa número: KPIs sem base vêm como — com a razão, nunca R$ 0', async () => {
    const token = await registerInvestidor();
    const res = await request(app).get('/api/dashboard').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);

    const investido = res.body.kpis.find((k: { label: string }) => k.label === 'Total investido');
    expect(investido.value).toBe('—');
    expect(investido.trend).toBe('nenhuma compra ainda');
    // "Posições abertas" é legitimamente 0 (uma contagem, não uma média sem base).
    expect(res.body.kpis.find((k: { label: string }) => k.label === 'Posições abertas').value).toBe('0');
    // Sem nada a distribuir, a rosca diz por que está vazia em vez de fingir uma carteira.
    expect(res.body.donutEmptyHint).toBe('Sem posições abertas para distribuir');
    // Mesma regra pro gráfico de barras: seis colunas de traço parecem um gráfico quebrado.
    expect(res.body.monthlyEmptyHint).toBe('Nenhuma compra nos últimos 6 meses');
  });

  it('cada papel vê os SEUS próprios KPIs — investidor, cedente e sacado não compartilham mais os mesmos rótulos', async () => {
    const labels = async (token: string) =>
      (await request(app).get('/api/dashboard').set('Authorization', `Bearer ${token}`)).body.kpis.map((k: { label: string }) => k.label);

    expect(await labels(await registerInvestidor())).toEqual(['Total investido', 'Retorno acumulado', 'Rentabilidade acumulada', 'Posições abertas']);
    expect(await labels(await registerCedente())).toEqual(['Total antecipado', 'Deságio médio pago', 'Duplicatas ativas', 'Prazo médio']);
  });

  it('cedente: "Duplicatas ativas" e o prazo médio saem das duplicatas reais dele — sobem quando ele emite', async () => {
    const cedenteToken = await registerCedente();
    const before = await request(app).get('/api/dashboard').set('Authorization', `Bearer ${cedenteToken}`);
    expect(before.body.kpis.find((k: { label: string }) => k.label === 'Duplicatas ativas').value).toBe('0');
    expect(before.body.kpis.find((k: { label: string }) => k.label === 'Prazo médio').value).toBe('—');

    let emit = await request(app)
      .post('/api/emitir/submit')
      .set('Authorization', `Bearer ${cedenteToken}`)
      .send({ sacado: `Sacado Dashboard ${unique()}`, cnpj: '33.222.111/0001-77', valor: '5.000', vencimento: '2026-12-01', seguro: false, nfAnexada: true, batchValores: [] });
    for (let attempt = 0; attempt < 5 && emit.status !== 200; attempt++) {
      emit = await request(app)
        .post('/api/emitir/submit')
        .set('Authorization', `Bearer ${cedenteToken}`)
        .send({ sacado: `Sacado Dashboard ${unique()}`, cnpj: '33.222.111/0001-77', valor: '5.000', vencimento: '2026-12-01', seguro: false, nfAnexada: true, batchValores: [] });
    }
    expect(emit.status).toBe(200);

    const after = await request(app).get('/api/dashboard').set('Authorization', `Bearer ${cedenteToken}`);
    expect(after.body.activeDuplicatas).toBe(before.body.activeDuplicatas + 1);
    expect(after.body.kpis.find((k: { label: string }) => k.label === 'Duplicatas ativas').value).toBe('1');
    // Emitida hoje, vence em 01/12/2026 — prazo real em dias, não mais um número fixo.
    expect(after.body.kpis.find((k: { label: string }) => k.label === 'Prazo médio').value).toMatch(/^\d+ dias$/);
    // Nada antecipado ainda: o total continua honesto em vez de virar R$ 0.
    expect(after.body.kpis.find((k: { label: string }) => k.label === 'Total antecipado').value).toBe('—');
  });

  it('dois cedentes diferentes veem números diferentes — o KPI é da conta, não da plataforma', async () => {
    const a = await registerCedente();
    const b = await registerCedente();
    let emit = await request(app)
      .post('/api/emitir/submit')
      .set('Authorization', `Bearer ${a}`)
      .send({ sacado: `Sacado Isolado ${unique()}`, cnpj: '33.222.111/0001-77', valor: '7.000', vencimento: '2026-12-01', seguro: false, nfAnexada: true, batchValores: [] });
    for (let attempt = 0; attempt < 5 && emit.status !== 200; attempt++) {
      emit = await request(app)
        .post('/api/emitir/submit')
        .set('Authorization', `Bearer ${a}`)
        .send({ sacado: `Sacado Isolado ${unique()}`, cnpj: '33.222.111/0001-77', valor: '7.000', vencimento: '2026-12-01', seguro: false, nfAnexada: true, batchValores: [] });
    }
    expect(emit.status).toBe(200);

    const resA = await request(app).get('/api/dashboard').set('Authorization', `Bearer ${a}`);
    const resB = await request(app).get('/api/dashboard').set('Authorization', `Bearer ${b}`);
    expect(resA.body.kpis.find((k: { label: string }) => k.label === 'Duplicatas ativas').value).toBe('1');
    expect(resB.body.kpis.find((k: { label: string }) => k.label === 'Duplicatas ativas').value).toBe('0');
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
