import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { db } from '../src/db/index.js';
import { createDuplicata, getDuplicata } from '../src/db/duplicatas.js';
import { ensureAceite, setAceiteStatus } from '../src/db/aceites.js';
import { createPayable } from '../src/db/payables.js';
import { buildCfoRecommendation, candidatasParaAntecipacao } from '../src/lib/cfoDecisionEngine.js';

// O Motor de Decisão do CFO: da projeção de déficit à recomendação executável. Antes dele,
// todas as peças existiam soltas (forecast, elegibilidade, preço, cotação de seguro, leilão) e
// nada as compunha — o agente cfoAntecipacao só listava recebíveis ordenados por risco.

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function registerCedentePro() {
  const email = `ced-cfo-${unique()}@example.com`;
  const reg = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Cedente CFO', email, password: 'senha123', companyName: `Cedente CFO ${unique()}`, role: 'cedente' });
  const token = reg.body.token as string;
  await request(app).post('/api/billing/checkout').set('Authorization', `Bearer ${token}`).send({ plan: 'pro' });
  return { token, userId: reg.body.user.id as number };
}

function isoDaysFromNow(dias: number): string {
  const d = new Date(Date.now() + dias * 86_400_000);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

/** Duplicata pronta pra leilão: lastro 100%, aprovada e com aceite confirmado. */
function duplicataElegivel(cedenteId: number, valor: number, vencimentoDias: number, sacado = `Sacado CFO ${unique()} Ltda`) {
  const d = createDuplicata({
    cedenteId,
    cedenteNome: 'Cedente CFO',
    sacadoNome: sacado,
    sacadoCnpj: '',
    valor,
    vencimento: isoDaysFromNow(vencimentoDias),
    emissao: isoDaysFromNow(-10),
    status: 'aprovada',
    lastroPct: 100,
    seguro: false,
  });
  setAceiteStatus(ensureAceite(d.id, 'Aceite confirmado na emissão').id, 'aceita');
  return d.id;
}

/** Uma conta a pagar grande e próxima cria o déficit projetado. */
function criarDeficit(cedenteId: number, valor: number, emDias: number) {
  createPayable({
    cedenteId,
    descricao: 'Folha de pagamento',
    fornecedor: 'Fornecedor X',
    categoria: 'pessoal',
    valor,
    vencimento: isoDaysFromNow(emDias),
    recorrente: false,
  });
}

describe('Motor de Decisão do CFO', () => {
  it('sem déficit projetado, recomenda explicitamente não fazer nada', async () => {
    const { userId } = await registerCedentePro();
    duplicataElegivel(userId, 50000, 60);

    const rec = await buildCfoRecommendation(userId, 'pro', '');
    expect(rec.temDeficit).toBe(false);
    expect(rec.plano).toBeNull();
    expect(rec.motivo).toBe('sem_deficit');
    expect(rec.mensagem).toContain('Não há motivo para antecipar');
  });

  it('com déficit, monta um plano que cobre a falta e só usa duplicata que o leilão aceitaria', async () => {
    const { userId } = await registerCedentePro();
    criarDeficit(userId, 120000, 30);
    const elegivel = duplicataElegivel(userId, 80000, 90);
    const semAceite = createDuplicata({
      cedenteId: userId, cedenteNome: 'Cedente CFO', sacadoNome: `Sem Aceite ${unique()}`, sacadoCnpj: '',
      valor: 90000, vencimento: isoDaysFromNow(90), emissao: isoDaysFromNow(-10), status: 'aprovada', lastroPct: 100, seguro: false,
    });

    const rec = await buildCfoRecommendation(userId, 'pro', '');
    expect(rec.temDeficit).toBe(true);
    expect(rec.deficit!.valor).toBeGreaterThan(0);
    expect(rec.plano).toBeTruthy();

    const ids = rec.plano!.itens.map((i) => i.duplicataId);
    expect(ids).toContain(elegivel);
    // Sem aceite do sacado, dispararLeilao recusaria — recomendar seria oferecer o impossível.
    expect(ids).not.toContain(semAceite.id);
    expect(rec.plano!.custoTotal).toBeGreaterThan(0);
    expect(rec.plano!.custoPct).toBeGreaterThan(0);
  });

  it('ignora duplicata que vence ANTES do déficit — ela já está no saldo projetado daquela data', async () => {
    const { userId } = await registerCedentePro();
    criarDeficit(userId, 100000, 45);
    const venceAntes = duplicataElegivel(userId, 70000, 20);
    const venceDepois = duplicataElegivel(userId, 70000, 120);

    const candidatas = candidatasParaAntecipacao(userId, 45).map((d) => d.id);
    expect(candidatas).toContain(venceDepois);
    expect(candidatas).not.toContain(venceAntes);
  });

  it('ordena por custo por real levantado: a mais barata entra antes da de maior score', async () => {
    const { userId } = await registerCedentePro();
    criarDeficit(userId, 40000, 30);
    // Mesmo valor; a de prazo curto tem deságio menor (o desconto é proporcional ao prazo),
    // então custa menos por real levantado mesmo que a outra tenha sacado melhor.
    const curta = duplicataElegivel(userId, 60000, 60, 'Grupo Atlas Varejo');
    const longa = duplicataElegivel(userId, 60000, 300, 'Grupo Atlas Varejo');

    const rec = await buildCfoRecommendation(userId, 'pro', '');
    expect(rec.plano!.itens[0].duplicataId).toBe(curta);
    expect(rec.plano!.itens.map((i) => i.duplicataId)).not.toEqual([longa]);
  });

  it('a variante com seguro custa exatamente o prêmio a mais, e nomeia a seguradora', async () => {
    const { userId } = await registerCedentePro();
    criarDeficit(userId, 30000, 30);
    duplicataElegivel(userId, 50000, 90);

    const rec = await buildCfoRecommendation(userId, 'pro', '');
    const sem = rec.plano!;
    const com = rec.planoComSeguro!;
    expect(com.itens).toHaveLength(sem.itens.length);
    expect(com.custoTotal).toBeGreaterThan(sem.custoTotal);
    const premios = com.itens.reduce((s, i) => s + i.premio, 0);
    expect(com.custoTotal - sem.custoTotal).toBeCloseTo(premios, 5);
    expect(com.itens[0].seguradora).toBeTruthy();
  });

  it('diz quanto custaria esperar até a data do déficit em vez de antecipar hoje', async () => {
    const { userId } = await registerCedentePro();
    criarDeficit(userId, 40000, 60);
    duplicataElegivel(userId, 80000, 200);

    const rec = await buildCfoRecommendation(userId, 'pro', '');
    expect(rec.esperar).toBeTruthy();
    // Deságio é proporcional ao prazo restante: esperar sempre custa menos, e a recomendação
    // precisa dizer isso pra "antecipar agora" ser escolha, não pressuposto.
    expect(rec.esperar!.economiaFmt).toBeTruthy();
  });
});

describe('POST /cashflow/recomendacao/executar', () => {
  it('abre o leilão das duplicatas do plano com a reserva escolhida e ignora id não elegível', async () => {
    const { token, userId } = await registerCedentePro();
    criarDeficit(userId, 60000, 30);
    const elegivel = duplicataElegivel(userId, 70000, 90);

    const rec = await request(app).get('/api/cashflow/recomendacao').set('Authorization', `Bearer ${token}`);
    expect(rec.status).toBe(200);
    expect(rec.body.plano.itens.length).toBeGreaterThan(0);

    const exec = await request(app)
      .post('/api/cashflow/recomendacao/executar')
      .set('Authorization', `Bearer ${token}`)
      .send({ duplicataIds: [elegivel, 'DUP-INEXISTENTE'], comSeguro: true, taxaMaxima: 2.5 });
    expect(exec.status).toBe(200);
    expect(exec.body.abertas).toEqual([elegivel]);
    expect(exec.body.ignoradas).toEqual(['DUP-INEXISTENTE']);

    const d = getDuplicata(elegivel)!;
    expect(d.status).toBe('no_mercado');
    expect(d.reserva_taxa_am).toBeCloseTo(2.5, 5);
    expect(d.insurer_key).toBeTruthy();
  });

  it('exige plano pro — cedente básico não acessa a recomendação', async () => {
    const email = `ced-basico-${unique()}@example.com`;
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ nome: 'Básico', email, password: 'senha123', companyName: 'Cedente Básico', role: 'cedente' });
    const res = await request(app).get('/api/cashflow/recomendacao').set('Authorization', `Bearer ${reg.body.token}`);
    // 402 (e não 403) é o que requirePlan devolve: falta plano, não falta permissão.
    expect(res.status).toBe(402);
  });
});
