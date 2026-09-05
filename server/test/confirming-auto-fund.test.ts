import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { db } from '../src/db/index.js';
import { approveKyb } from '../src/db/users.js';
import { getFundoBalance } from '../src/db/confirmingFundo.js';
import { getProgramaBySacado } from '../src/db/confirming.js';
import { getDuplicata } from '../src/db/duplicatas.js';
import { computePurchasePrice } from '../src/lib/marketCompute.js';
import { runFundoAutoBuyTick } from '../src/lib/confirmingFundoAutoBuy.js';
import { arrematar, darLance, fecharLeiloes } from './helpers/auction.js';

// Achado corrigido (mudança de modelo de negócio): o financiamento automático do Programa
// Confirming costumava pular o leilão inteiramente na emissão (a suíte antiga cobria esse
// desenho). O Fundo de Fomento agora nunca tem atalho — só compra depois que a duplicata
// passou pelo aceite e foi de fato a leilão, competindo pelo mesmo caminho de compra que
// qualquer banco/investidor usaria, na taxa DINÂMICA de mercado (nunca a taxa negociada do
// programa, que virou só um teto). Ver README ("Fundo de Fomento do Confirming passa a
// disputar dentro do leilão") pro raciocínio completo.

beforeAll(async () => {
  await seedIfEmpty();
});

function unique(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function register(role: 'cedente' | 'sacado' | 'investidor', companyName: string) {
  const email = `${unique(role)}@example.com`;
  const res = await request(app).post('/api/auth/register').send({ nome: 'Teste', email, password: 'senha123', companyName, role });
  return { token: res.body.token as string, userId: res.body.user.id as number };
}

// Grupo Atlas Varejo tem perfil interno seedado (score 84 → rating AA) — a única forma
// determinística de dar ao programa uma taxa real sem depender de sinais de rede. Usado só
// pelo CNPJ na criação do programa, não pelo nome da conta sacado.
const CNPJ_COM_HISTORICO = '12.345.678/0001-90';

// /api/emitir/submit passa pelo registro simulado (~12% de indisponibilidade de
// propósito) — retry até 5x, mesmo padrão de aceites-disputas.test.ts.
async function emitirComRetry(token: string, body: Record<string, unknown>) {
  let res = await request(app).post('/api/emitir/submit').set('Authorization', `Bearer ${token}`).send(body);
  for (let attempt = 0; attempt < 4 && res.status !== 200; attempt++) {
    res = await request(app).post('/api/emitir/submit').set('Authorization', `Bearer ${token}`).send(body);
  }
  return res;
}

// Checklist de lastro precisa bater 100% (nfAnexada + os demais campos) pra dispararLeilao
// funcionar — mesmo gate que já existe pra uma duplicata chegar em 'aprovada'.
function formCompleto(sacado: string, valor: string) {
  return { sacado, cnpj: '99.999.999/0001-99', valor, vencimento: '2026-12-01', seguro: false, nfAnexada: true, batchValores: [] };
}

async function criarProgramaEMatricular(sacadoToken: string, cedenteUserId: number, limite = '500.000') {
  await request(app).post('/api/confirming/criar').set('Authorization', `Bearer ${sacadoToken}`).send({ cnpj: CNPJ_COM_HISTORICO, limite });
  await request(app).post('/api/confirming/membros').set('Authorization', `Bearer ${sacadoToken}`).send({ cedenteUserId });
}

// runFundoAutoBuyTick só financia se o fundo tiver caixa real (getFundoBalance) — sem
// aporte, o teste cairia no fallback (não compra) em vez de financiar.
async function aportarNoFundo(valor: number) {
  const { token } = await register('investidor', unique('Investidor Fundo'));
  await request(app).post('/api/confirming-fundo/contribuir').set('Authorization', `Bearer ${token}`).send({ valor });
}

async function findAceite(sacadoToken: string, duplicataId: string) {
  const res = await request(app).get('/api/aceites').set('Authorization', `Bearer ${sacadoToken}`);
  return res.body.aceites.find((a: { duplicataId: string }) => a.duplicataId === duplicataId);
}

// O sacado aceita de verdade (via HTTP, como faria no Portal do Sacado) e o cedente
// dispara o leilão — mesmo requisito de qualquer duplicata desde a correção do gate de
// negociação (routes/minhas.ts's dispararLeilao exige aceite confirmado).
async function aceitarEDisparar(cedenteToken: string, sacadoToken: string, duplicataId: string) {
  const aceite = await findAceite(sacadoToken, duplicataId);
  const accept = await request(app).post(`/api/aceites/${aceite.id}/status`).set('Authorization', `Bearer ${sacadoToken}`).send({ status: 'aceita' });
  expect(accept.status).toBe(200);
  const leilao = await request(app).post(`/api/minhas/${duplicataId}/leilao`).set('Authorization', `Bearer ${cedenteToken}`);
  expect(leilao.status).toBe(200);
}

// computePurchasePrice(d) sem override lê a taxa dinâmica de mercado real (via
// estimateRateBand, que muda com o tempo/atividade — lib/dynamicPricing.ts) OU, se
// d.desagio já estiver setado, usa esse valor fixo direto (lib/marketCompute.ts's
// effectiveMonthlyRatePct) — mesmo campo que uma duplicata real nunca tem preenchido até
// ser negociada. Setar aqui direto no banco dá controle determinístico sobre a taxa que o
// fundo vê pra comparar contra o teto do programa (programa.taxa_am), sem depender do
// sinal de liquidez ao vivo (que muda conforme outros testes deste arquivo emitem/compram).
function setDesagio(duplicataId: string, taxaAmPct: number) {
  db.prepare('UPDATE duplicatas SET desagio = ? WHERE id = ?').run(taxaAmPct.toFixed(2).replace('.', ','), duplicataId);
}

describe('Fundo de Fomento do Confirming — compra dentro do leilão, nunca por atalho', () => {
  it('compra a duplicata pelo caminho normal de compra quando a taxa de mercado cabe no teto negociado', async () => {
    const sacadoCompany = unique('Sacado Programa');
    const { token: sacadoToken, userId: sacadoUserId } = await register('sacado', sacadoCompany);
    const { token: cedenteToken, userId: cedenteUserId } = await register('cedente', unique('Fornecedor Confirmado'));
    await criarProgramaEMatricular(sacadoToken, cedenteUserId);
    await aportarNoFundo(50000);

    const emit = await emitirComRetry(cedenteToken, formCompleto(sacadoCompany, '10.000'));
    expect(emit.status).toBe(200);
    const duplicataId = emit.body.duplicataId as string;

    const programa = getProgramaBySacado(sacadoUserId)!;
    setDesagio(duplicataId, programa.taxa_am - 0.3); // dentro do teto, com folga
    await aceitarEDisparar(cedenteToken, sacadoToken, duplicataId);

    const balanceBefore = getFundoBalance();
    const { lances } = await runFundoAutoBuyTick();
    expect(lances).toBe(1);
    // Propor um lance não move dinheiro: o pool só é debitado quando o lance vence o leilão
    // (lib/auctionClose.ts chama settleFundoWin). Até o fechamento, saldo intacto.
    expect(getFundoBalance()).toBe(balanceBefore);
    expect(getDuplicata(duplicataId)!.status).toBe('no_mercado');

    expect(fecharLeiloes(duplicataId)).toMatchObject({ vendidos: 1 });

    // O fundo pagou pela compra de verdade — saldo do pool caiu no preço com deságio da
    // taxa DINÂMICA de mercado (sem override), não a taxa negociada do programa.
    const duplicata = getDuplicata(duplicataId)!;
    expect(duplicata.status).toBe('vendida');
    const { precoCompra } = computePurchasePrice(duplicata);
    expect(getFundoBalance()).toBeCloseTo(balanceBefore - precoCompra, 6);

    const minhas = await request(app).get('/api/minhas').set('Authorization', `Bearer ${cedenteToken}`);
    const dup = minhas.body.duplicatas.find((d: { id: string }) => d.id === duplicataId);
    expect(dup.status).toBe('Vendida');

    // O programa e a matrícula do cedente registraram o uso.
    const meuPrograma = await request(app).get('/api/confirming/meu-programa').set('Authorization', `Bearer ${sacadoToken}`);
    expect(meuPrograma.body.programa.utilizadoFmt).toContain('10.000');
  });

  it('cedente não matriculado segue o fluxo normal do marketplace — o fundo não compra', async () => {
    const sacadoCompany = unique('Sacado Sem Matricula');
    const { token: sacadoToken } = await register('sacado', sacadoCompany);
    await request(app).post('/api/confirming/criar').set('Authorization', `Bearer ${sacadoToken}`).send({ cnpj: CNPJ_COM_HISTORICO, limite: '500.000' });

    const { token: cedenteToken } = await register('cedente', unique('Fornecedor Não Matriculado'));
    const emit = await emitirComRetry(cedenteToken, formCompleto(sacadoCompany, '5.000'));
    expect(emit.status).toBe(200);
    const duplicataId = emit.body.duplicataId as string;
    setDesagio(duplicataId, 1.0); // taxa baixa — não é o motivo do bloqueio aqui

    await aceitarEDisparar(cedenteToken, sacadoToken, duplicataId);
    const { lances } = await runFundoAutoBuyTick();
    expect(lances).toBe(0);
    expect(getDuplicata(duplicataId)!.status).toBe('no_mercado');
  });

  it('programa pausado nunca financia, mesmo com cedente matriculado', async () => {
    const sacadoCompany = unique('Sacado Pausado');
    const { token: sacadoToken } = await register('sacado', sacadoCompany);
    const { token: cedenteToken, userId: cedenteUserId } = await register('cedente', unique('Fornecedor Programa Pausado'));
    await criarProgramaEMatricular(sacadoToken, cedenteUserId);
    await aportarNoFundo(50000);
    await request(app).post('/api/confirming/pausar').set('Authorization', `Bearer ${sacadoToken}`);

    const emit = await emitirComRetry(cedenteToken, formCompleto(sacadoCompany, '5.000'));
    expect(emit.status).toBe(200);
    const duplicataId = emit.body.duplicataId as string;
    setDesagio(duplicataId, 1.0);
    await aceitarEDisparar(cedenteToken, sacadoToken, duplicataId);

    const { lances } = await runFundoAutoBuyTick();
    expect(lances).toBe(0);
    expect(getDuplicata(duplicataId)!.status).toBe('no_mercado');
  });

  it('sem caixa real no fundo, cai no fallback — a oferta segue disponível pra qualquer investidor', async () => {
    const sacadoCompany = unique('Sacado Fundo Vazio');
    const { token: sacadoToken } = await register('sacado', sacadoCompany);
    const { token: cedenteToken, userId: cedenteUserId } = await register('cedente', unique('Fornecedor Fundo Vazio'));
    await criarProgramaEMatricular(sacadoToken, cedenteUserId);
    // Nenhum aporte feito nesta rodada — o programa tem limite de sobra, mas o fundo pode
    // ter algum resíduo de caixa de outros testes deste arquivo (mesma instância de banco,
    // sem reset entre os `it()`s). Pede um valor de face generosamente maior que 3x o que
    // já existe em caixa, pra garantir que o preço com deságio (sempre > 40% do valor de
    // face — o desconto máximo é limitado a 60%, MAX_DESCONTO_PCT em lib/marketCompute.ts)
    // ainda assim exceda o saldo disponível.
    const balanceBefore = getFundoBalance();

    const emit = await emitirComRetry(cedenteToken, formCompleto(sacadoCompany, String(Math.round(balanceBefore * 3) + 1000)));
    expect(emit.status).toBe(200);
    const duplicataId = emit.body.duplicataId as string;
    setDesagio(duplicataId, 1.0); // taxa baixa — não é o motivo do bloqueio aqui
    await aceitarEDisparar(cedenteToken, sacadoToken, duplicataId);

    const { lances } = await runFundoAutoBuyTick();
    expect(lances).toBe(0);
    expect(getFundoBalance()).toBe(balanceBefore);
    expect(getDuplicata(duplicataId)!.status).toBe('no_mercado');

    // Limpeza: sem isso, um aporte feito por um teste seguinte (mesma instância de banco,
    // sem reset entre os `it()`s) tornaria esta oferta retroativamente elegível — o único
    // motivo do bloqueio aqui foi caixa insuficiente NO MOMENTO, não uma condição
    // permanente como os outros testes deste arquivo (limite, sublimite, teto de taxa).
    db.prepare("UPDATE duplicatas SET status = 'vendida' WHERE id = ?").run(duplicataId);
  });

  it('respeita o limite agregado do programa — acima dele, cai no fallback em vez de sobrefinanciar', async () => {
    const sacadoCompany = unique('Sacado Limite Baixo');
    const { token: sacadoToken } = await register('sacado', sacadoCompany);
    const { token: cedenteToken, userId: cedenteUserId } = await register('cedente', unique('Fornecedor Estourou Limite'));
    await criarProgramaEMatricular(sacadoToken, cedenteUserId, '10.000');
    await aportarNoFundo(500000);

    const emit = await emitirComRetry(cedenteToken, formCompleto(sacadoCompany, '50.000'));
    expect(emit.status).toBe(200);
    const duplicataId = emit.body.duplicataId as string;
    setDesagio(duplicataId, 1.0);
    await aceitarEDisparar(cedenteToken, sacadoToken, duplicataId);

    const { lances } = await runFundoAutoBuyTick();
    expect(lances).toBe(0);
    expect(getDuplicata(duplicataId)!.status).toBe('no_mercado');
  });

  it('respeita um sublimite por cedente mesmo quando o limite do programa tem espaço', async () => {
    const sacadoCompany = unique('Sacado Sublimite');
    const { token: sacadoToken } = await register('sacado', sacadoCompany);
    const { token: cedenteToken, userId: cedenteUserId } = await register('cedente', unique('Fornecedor Sublimite'));
    await request(app).post('/api/confirming/criar').set('Authorization', `Bearer ${sacadoToken}`).send({ cnpj: CNPJ_COM_HISTORICO, limite: '500.000' });
    await request(app).post('/api/confirming/membros').set('Authorization', `Bearer ${sacadoToken}`).send({ cedenteUserId, sublimite: '5.000' });
    await aportarNoFundo(500000);

    const emit = await emitirComRetry(cedenteToken, formCompleto(sacadoCompany, '20.000'));
    expect(emit.status).toBe(200);
    const duplicataId = emit.body.duplicataId as string;
    setDesagio(duplicataId, 1.0);
    await aceitarEDisparar(cedenteToken, sacadoToken, duplicataId);

    const { lances } = await runFundoAutoBuyTick();
    expect(lances).toBe(0);
    expect(getDuplicata(duplicataId)!.status).toBe('no_mercado');
  });

  it('taxa de mercado acima do teto negociado com o sacado — o fundo não compra', async () => {
    const sacadoCompany = unique('Sacado Taxa Alta');
    const { token: sacadoToken, userId: sacadoUserId } = await register('sacado', sacadoCompany);
    const { token: cedenteToken, userId: cedenteUserId } = await register('cedente', unique('Fornecedor Taxa Alta'));
    await criarProgramaEMatricular(sacadoToken, cedenteUserId);
    await aportarNoFundo(500000);

    const emit = await emitirComRetry(cedenteToken, formCompleto(sacadoCompany, '10.000'));
    expect(emit.status).toBe(200);
    const duplicataId = emit.body.duplicataId as string;

    const programa = getProgramaBySacado(sacadoUserId)!;
    setDesagio(duplicataId, programa.taxa_am + 1.0); // acima do teto negociado
    await aceitarEDisparar(cedenteToken, sacadoToken, duplicataId);

    const { lances } = await runFundoAutoBuyTick();
    expect(lances).toBe(0);
    expect(getDuplicata(duplicataId)!.status).toBe('no_mercado');
  });

  it('outro investidor comprando primeiro ganha a corrida — o tick do fundo não faz nada, sem erro', async () => {
    const sacadoCompany = unique('Sacado Corrida');
    const { token: sacadoToken, userId: sacadoUserId } = await register('sacado', sacadoCompany);
    const { token: cedenteToken, userId: cedenteUserId } = await register('cedente', unique('Fornecedor Corrida'));
    await criarProgramaEMatricular(sacadoToken, cedenteUserId);
    await aportarNoFundo(500000);

    const emit = await emitirComRetry(cedenteToken, formCompleto(sacadoCompany, '10.000'));
    expect(emit.status).toBe(200);
    const duplicataId = emit.body.duplicataId as string;

    const programa = getProgramaBySacado(sacadoUserId)!;
    setDesagio(duplicataId, programa.taxa_am - 0.3); // dentro do teto — o fundo compraria, se chegasse primeiro
    await aceitarEDisparar(cedenteToken, sacadoToken, duplicataId);

    const { token: outroInvestidorToken, userId: outroInvestidorId } = await register('investidor', unique('Investidor Rápido'));
    approveKyb(outroInvestidorId);
    const buy = (await arrematar(outroInvestidorToken, duplicataId)).lance;
    expect(buy.status).toBe(200);

    const balanceBefore = getFundoBalance();
    const { lances } = await runFundoAutoBuyTick();
    expect(lances).toBe(0);
    expect(getFundoBalance()).toBe(balanceBefore); // fundo não gastou nada — não era mais dele pra comprar

    const purchase = db.prepare('SELECT investor_id FROM purchases WHERE duplicata_id = ?').get(duplicataId) as { investor_id: number };
    expect(purchase.investor_id).toBe(outroInvestidorId);
  });
});
