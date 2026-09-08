import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { PLATFORM_FEE_TIERS, platformFeePct, platformFee } from '../src/lib/settlement.js';
import { getUserByEmail } from '../src/db/users.js';
import { listPurchasesByInvestor } from '../src/db/duplicatas.js';
import { parseFlexibleDate, toIsoUtc } from '../src/lib/format.js';

// Últimos três achados da varredura pelos seis papéis.

beforeAll(async () => {
  await seedIfEmpty();
});

describe('a taxa de plataforma é escalonada, e a tela diz a mesma coisa que o cálculo', () => {
  it('as faixas publicadas reproduzem platformFeePct em todos os patamares', () => {
    expect(PLATFORM_FEE_TIERS).toHaveLength(3);
    // Toda faixa tem que devolver a própria alíquota para um valor dentro dela.
    for (const [i, tier] of PLATFORM_FEE_TIERS.entries()) {
      const anterior = i === 0 ? 0 : PLATFORM_FEE_TIERS[i - 1].ateValor!;
      const dentro = tier.ateValor === null ? anterior * 2 : (anterior + tier.ateValor) / 2;
      expect(platformFeePct(dentro), `faixa "${tier.label}"`).toBe(tier.pct);
    }
  });

  it('respeita as fronteiras exatas — o teto de cada faixa ainda pertence a ela', () => {
    // Comportamento do ternário original: > 200_000 é que sobe de faixa, então exatamente
    // 200.000 paga 0,35% e exatamente 1.000.000 paga 0,30%.
    expect(platformFeePct(200_000)).toBe(0.0035);
    expect(platformFeePct(200_001)).toBe(0.003);
    expect(platformFeePct(1_000_000)).toBe(0.003);
    expect(platformFeePct(1_000_001)).toBe(0.0025);
    // E a taxa cai de fato conforme o valor sobe — é uma escada, não um número só.
    expect(platformFeePct(100_000)).toBeGreaterThan(platformFeePct(500_000));
    expect(platformFeePct(500_000)).toBeGreaterThan(platformFeePct(2_000_000));
  });

  it('a conta recebe as faixas do servidor, em vez de a tela reescrever os números', async () => {
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ nome: 'Conta Varredura', email: `conta-varr-${Date.now()}@example.com`, password: 'senha123', companyName: 'Conta Varr', role: 'cedente' });
    const res = await request(app).get('/api/account').set('Authorization', `Bearer ${reg.body.token}`);
    expect(res.status).toBe(200);
    expect(res.body.taxaFaixas).toHaveLength(PLATFORM_FEE_TIERS.length);
    expect(res.body.taxaFaixas.map((f: { pctFmt: string }) => f.pctFmt)).toEqual(['0,35%', '0,30%', '0,25%']);
    // A frase antiga dizia 0,35% para toda operação: uma de R$ 500 mil paga menos que isso.
    expect(platformFee(500_000)).toBeLessThan(500_000 * 0.0035);
  });
});

describe('as compras semeadas são operações que existem', () => {
  it('nenhuma tem carência zero ou negativa', () => {
    const inv = getUserByEmail('investidor@lastro.demo')!;
    const purchases = listPurchasesByInvestor(inv.id);
    expect(purchases.length).toBeGreaterThan(0);

    for (const p of purchases) {
      const dias = Math.round(
        (parseFlexibleDate(p.vencimento).getTime() - new Date(toIsoUtc(p.created_at)).getTime()) / (24 * 3600 * 1000)
      );
      // Comprar um recebível no dia em que ele vence não é uma operação real, e era o que o
      // seed produzia ao usar a mesma data para emissão, vencimento e compra.
      expect(dias, `${p.duplicata_id} comprada em ${p.created_at} vencendo em ${p.vencimento}`).toBeGreaterThan(0);
    }
  });

  it('há posições com prazo suficiente para serem anualizadas de verdade', async () => {
    // O caminho feliz de lib/investorPerformance.ts: antes, TODAS as posições semeadas caíam
    // no "não anualizado", então a tela demo nunca exercitava o cálculo real.
    const inv = getUserByEmail('investidor@lastro.demo')!;
    const { buildPerformanceDashboard, DIAS_MINIMOS_PARA_ANUALIZAR } = await import('../src/lib/investorPerformance.js');
    const view = buildPerformanceDashboard(inv.id);
    const anualizadas = view.positions.filter((p) => p.retornoAnualizadoPct !== null);
    expect(anualizadas.length).toBeGreaterThan(0);
    for (const p of anualizadas) expect(p.diasCarencia).toBeGreaterThanOrEqual(DIAS_MINIMOS_PARA_ANUALIZAR);
    // E o número resultante é plausível para este mercado, não centenas de por cento.
    expect(view.retornoMedioPonderadoPct).not.toBeNull();
    expect(view.retornoMedioPonderadoPct!).toBeLessThan(100);
  });
});

describe('o papel de auditor pode ser demonstrado', () => {
  it('existe uma conta de auditor semeada, e ela chega ao painel somente-leitura', async () => {
    const aud = getUserByEmail('auditor@lastro.demo');
    expect(aud).toBeTruthy();
    expect(aud!.role).toBe('auditor');

    const login = await request(app).post('/api/auth/login').send({ email: 'auditor@lastro.demo', password: 'demo1234' });
    expect(login.status).toBe(200);
    const painel = await request(app).get('/api/auditor/overview').set('Authorization', `Bearer ${login.body.token}`);
    expect(painel.status).toBe(200);
  });

  it('continua fora do registro público — não é um papel auto-servível', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ nome: 'Auto Auditor', email: `auto-aud-${Date.now()}@example.com`, password: 'senha123', companyName: 'X', role: 'auditor' });
    expect(res.status).toBe(400);
  });
});
