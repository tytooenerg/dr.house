import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { db } from '../src/db/index.js';
import { approveKyb, updateSubscription, getSettings, getUserById } from '../src/db/users.js';
import { createDuplicata, dispararLeilao, getDuplicata } from '../src/db/duplicatas.js';
import { ensureAceite, setAceiteStatus } from '../src/db/aceites.js';
import { currentFloor, nextStepAt, armLadder, getLadderBand } from '../src/lib/autoBidLadder.js';
import type { LadderConfig } from '../src/db/types.js';

// Achado corrigido (pedido do usuário): "taxa máxima a oferecer" era um teto de risco
// vestigial — o preço sempre foi calculado pelo servidor, o investidor nunca propunha nada
// de verdade. Este arquivo cobre a escada nova: começa exigente (taxa inicial — o melhor
// deságio da classe), relaxa um degrau por intervalo sem compra, nunca passa do piso (taxa
// alvo), e rearma quando compra ou quando o investidor edita a régua.

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function registerProInvestidor() {
  const email = `inv-ladder-${unique()}@example.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Investidor', email, password: 'senha123', companyName: `Fundo ${unique()}`, role: 'investidor' });
  approveKyb(res.body.user.id);
  updateSubscription(res.body.user.id, { plan: 'pro', subscriptionStatus: 'active' });
  return { token: res.body.token as string, userId: res.body.user.id as number };
}

describe('lib/autoBidLadder.ts — funções puras', () => {
  const baseCfg = (overrides: Partial<LadderConfig> = {}): LadderConfig => ({
    taxaInicial: 4,
    taxaAlvo: 1.5,
    decrementoPorEtapa: 0.5,
    intervaloHoras: 2,
    iniciadoEm: null,
    ...overrides,
  });

  it('nunca armada (iniciadoEm null) — fica no degrau mais exigente, taxaInicial', () => {
    expect(currentFloor(baseCfg(), 'A')).toBe(4);
  });

  it('decai um degrau por intervalo inteiro decorrido', () => {
    const cfg = baseCfg({ iniciadoEm: new Date(Date.now() - 2 * 3600_000).toISOString() }); // 2h atrás, intervalo 2h → 1 etapa
    expect(currentFloor(cfg, 'A')).toBe(3.5);
  });

  it('decai múltiplos degraus proporcionalmente ao tempo decorrido', () => {
    const cfg = baseCfg({ iniciadoEm: new Date(Date.now() - 5 * 3600_000).toISOString() }); // 5h / 2h → 2 etapas completas
    expect(currentFloor(cfg, 'A')).toBe(3);
  });

  it('nunca cai abaixo da taxa alvo, por mais tempo que passe', () => {
    const cfg = baseCfg({ iniciadoEm: new Date(Date.now() - 500 * 3600_000).toISOString() });
    expect(currentFloor(cfg, 'A')).toBe(1.5);
  });

  it('taxaInicial/taxaAlvo nulos usam a banda de mercado ao vivo da classe', () => {
    const cfg = baseCfg({ taxaInicial: null, taxaAlvo: null });
    const band = getLadderBand('AA');
    expect(currentFloor(cfg, 'AA')).toBe(band.max);
    expect(currentFloor({ ...cfg, iniciadoEm: new Date(Date.now() - 1000 * 3600_000).toISOString() }, 'AA')).toBe(band.min);
  });

  it('nextStepAt é null quando a escada nunca foi armada', () => {
    expect(nextStepAt(baseCfg(), 'A')).toBeNull();
  });

  it('nextStepAt é null quando já está no piso (parou de decair)', () => {
    const cfg = baseCfg({ iniciadoEm: new Date(Date.now() - 500 * 3600_000).toISOString() });
    expect(nextStepAt(cfg, 'A')).toBeNull();
  });

  it('nextStepAt aponta pro próximo múltiplo de intervaloHoras a partir de quando armou', () => {
    const start = Date.now() - 1 * 3600_000; // armada há 1h, intervalo de 2h
    const cfg = baseCfg({ iniciadoEm: new Date(start).toISOString() });
    const next = nextStepAt(cfg, 'A')!;
    expect(next.getTime()).toBe(start + 2 * 3600_000);
  });

  it('armLadder rearma pro instante atual', () => {
    const before = Date.now();
    const { iniciadoEm } = armLadder();
    expect(new Date(iniciadoEm!).getTime()).toBeGreaterThanOrEqual(before);
  });
});

describe('POST /automacao/ladder — validação', () => {
  it('recusa taxa inicial menor que a taxa alvo — a escada só desce', async () => {
    const inv = await registerProInvestidor();
    const setInicial = await request(app)
      .post('/api/automacao/ladder')
      .set('Authorization', `Bearer ${inv.token}`)
      .send({ rating: 'A', field: 'taxaInicial', value: 5 });
    expect(setInicial.status).toBe(200);
    const setAlvo = await request(app)
      .post('/api/automacao/ladder')
      .set('Authorization', `Bearer ${inv.token}`)
      .send({ rating: 'A', field: 'taxaAlvo', value: 3 });
    expect(setAlvo.status).toBe(200);
    const res = await request(app)
      .post('/api/automacao/ladder')
      .set('Authorization', `Bearer ${inv.token}`)
      .send({ rating: 'A', field: 'taxaInicial', value: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
  });

  it('recusa decremento por etapa zero ou negativo', async () => {
    const inv = await registerProInvestidor();
    const res = await request(app)
      .post('/api/automacao/ladder')
      .set('Authorization', `Bearer ${inv.token}`)
      .send({ rating: 'B', field: 'decrementoPorEtapa', value: 0 });
    expect(res.status).toBe(400);
  });

  it('recusa intervalo em horas zero ou negativo', async () => {
    const inv = await registerProInvestidor();
    const res = await request(app)
      .post('/api/automacao/ladder')
      .set('Authorization', `Bearer ${inv.token}`)
      .send({ rating: 'B', field: 'intervaloHoras', value: -1 });
    expect(res.status).toBe(400);
  });

  it('editar um campo persiste e rearma a classe (piso atual volta a ser a taxa inicial)', async () => {
    const inv = await registerProInvestidor();
    const res = await request(app)
      .post('/api/automacao/ladder')
      .set('Authorization', `Bearer ${inv.token}`)
      .send({ rating: 'AA', field: 'taxaInicial', value: 3 });
    expect(res.status).toBe(200);
    expect(res.body.ladder.AA.taxaInicial).toBe(3);
    expect(res.body.ladder.AA.pisoAtualFmt).toBe('3,00%');
  });

  it('value null em taxaInicial/taxaAlvo volta a usar a banda de mercado ao vivo', async () => {
    const inv = await registerProInvestidor();
    await request(app).post('/api/automacao/ladder').set('Authorization', `Bearer ${inv.token}`).send({ rating: 'C', field: 'taxaInicial', value: 10 });
    const res = await request(app).post('/api/automacao/ladder').set('Authorization', `Bearer ${inv.token}`).send({ rating: 'C', field: 'taxaInicial', value: null });
    expect(res.status).toBe(200);
    const band = getLadderBand('C');
    expect(res.body.ladder.C.taxaInicial).toBeCloseTo(band.max, 5);
  });
});

describe('Automação de Lances — compra na classe rearma a escada', () => {
  it('compra automaticamente quando o deságio bate o piso, e rearma a escada dessa classe', async () => {
    const inv = await registerProInvestidor();
    // Isola o marketplace: sem isso, ofertas mais antigas (seed, sempre criado antes de
    // qualquer teste) seriam escolhidas primeiro por maybeTick (mais antiga primeiro),
    // tornando o teste não-determinístico. Escopo: só dentro do banco isolado deste arquivo.
    db.prepare("UPDATE duplicatas SET status = 'vendida' WHERE status = 'no_mercado'").run();

    await request(app).post('/api/automacao/toggle').set('Authorization', `Bearer ${inv.token}`);
    // scoreMin default é 'A' — a duplicata criada abaixo (sacado sem histórico, score null
    // → rating 'B' via ratingFromScore(60)) precisa de scoreMin 'C' pra não ser rejeitada
    // por esse critério antes mesmo de chegar na escada.
    await request(app).post('/api/automacao/rule').set('Authorization', `Bearer ${inv.token}`).send({ field: 'scoreMin', value: 'C' });

    const d = createDuplicata({
      cedenteId: null,
      cedenteNome: 'Cedente Escada Ltda',
      sacadoNome: `Sacado Escada ${unique()} Ltda`,
      sacadoCnpj: '',
      valor: 20000,
      vencimento: '2026-12-31',
      emissao: '10/08/2026',
      status: 'aprovada',
      lastroPct: 100,
      seguro: false,
    });
    const aceite = ensureAceite(d.id, 'Aceite confirmado na emissão');
    setAceiteStatus(aceite.id, 'aceita');
    // Deságio bem acima de qualquer banda real (a mais alta, C, vai a ~4-5% no pior caso) —
    // bate o piso inicial da escada (taxaInicial) sem precisar de nenhum decaimento.
    db.prepare("UPDATE duplicatas SET desagio = '50,00' WHERE id = ?").run(d.id);
    dispararLeilao(d.id, new Date(Date.now() + 3600_000).toISOString());

    const res = await request(app).get('/api/automacao').set('Authorization', `Bearer ${inv.token}`);
    expect(res.status).toBe(200);

    expect(getDuplicata(d.id)!.status).toBe('vendida');

    // Rating 'B' (score null → 60 via ratingFromScore) — a classe comprada foi rearmada.
    const settings = getSettings(getUserById(inv.userId)!);
    expect(settings.autoBidLadder.B.iniciadoEm).toBeTruthy();
    expect(Date.now() - new Date(settings.autoBidLadder.B.iniciadoEm!).getTime()).toBeLessThan(5000);
    expect(res.body.ladder.B.pisoAtualFmt).toBeTruthy();
  });
});
