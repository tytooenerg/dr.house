import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { getFundoBalance } from '../src/db/confirmingFundo.js';
import { computeFundoNav } from '../src/lib/confirmingFundo.js';
import { approveKyb } from '../src/db/users.js';
import { getProgramaBySacado } from '../src/db/confirming.js';
import { getDuplicata } from '../src/db/duplicatas.js';
import { computePurchasePrice } from '../src/lib/marketCompute.js';

// Nenhuma parte da plataforma modelava "sacado pagou no vencimento, caminho feliz" antes
// desta feature — nem o marketplace normal, nem a linha de crédito, nem o Confirming. Self-
// report do sacado (lib/aceiteCore.ts's reportPayment), mesmo padrão de auto-serviço já
// usado por POST /credit-line/repay (o pagador reporta, sem webhook de banco).

beforeAll(async () => {
  await seedIfEmpty();
});

function unique(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function register(role: 'cedente' | 'sacado' | 'investidor', companyName: string) {
  const email = `${unique(role)}@example.com`;
  const res = await request(app).post('/api/auth/register').send({ nome: 'Teste', email, password: 'senha123', companyName, role });
  // POST /market/:id/buy exige kyb_status 'approved' — mesmo padrão de settlement.test.ts.
  if (role === 'investidor') approveKyb(res.body.user.id);
  return { token: res.body.token as string, userId: res.body.user.id as number };
}

async function emitirComRetry(token: string, body: Record<string, unknown>) {
  let res = await request(app).post('/api/emitir/submit').set('Authorization', `Bearer ${token}`).send(body);
  for (let attempt = 0; attempt < 5 && res.status !== 200; attempt++) {
    res = await request(app).post('/api/emitir/submit').set('Authorization', `Bearer ${token}`).send(body);
  }
  return res;
}

function formCompleto(sacado: string, valor: string) {
  // nfAnexada: true — precisa de checklist 100% (status 'aprovada' na hora) pra poder
  // disparar leilão ou reportar pagamento direto; sem isso a duplicata fica
  // 'pendente_analise'.
  return { sacado, cnpj: '33.222.111/0001-77', valor, vencimento: '2026-12-01', seguro: false, nfAnexada: true, batchValores: [] };
}

async function extratoOf(token: string) {
  const res = await request(app).get('/api/account').set('Authorization', `Bearer ${token}`);
  return res.body.extrato as { descricao: string; isPositive: boolean; valorFmt: string }[];
}

async function findAceite(sacadoToken: string, duplicataId: string) {
  const res = await request(app).get('/api/aceites').set('Authorization', `Bearer ${sacadoToken}`);
  return res.body.aceites.find((a: { duplicataId: string }) => a.duplicataId === duplicataId);
}

describe('Reportar pagamento no vencimento — caminho feliz por tipo de credor', () => {
  it('duplicata vendida no marketplace: o investidor (credor atual) recebe o valor de face de volta', async () => {
    const sacadoCompany = unique('Sacado Pagamento Investidor');
    const { token: sacadoToken } = await register('sacado', sacadoCompany);
    const { token: cedenteToken } = await register('cedente', unique('Cedente Pagamento'));
    const { token: investidorToken } = await register('investidor', unique('Investidor Pagamento'));

    const emit = await emitirComRetry(cedenteToken, formCompleto(sacadoCompany, '20.000'));
    expect(emit.status).toBe(200);
    const duplicataId = emit.body.duplicataId as string;

    await request(app).post(`/api/minhas/${duplicataId}/leilao`).set('Authorization', `Bearer ${cedenteToken}`);
    const buy = await request(app).post(`/api/market/${duplicataId}/buy`).set('Authorization', `Bearer ${investidorToken}`);
    expect(buy.status).toBe(200);

    const aceite = await findAceite(sacadoToken, duplicataId);
    expect(aceite).toBeTruthy();
    expect(aceite.canReportPayment).toBe(true);

    const report = await request(app).post(`/api/aceites/${aceite.id}/pagamento`).set('Authorization', `Bearer ${sacadoToken}`);
    expect(report.status).toBe(200);

    const investorExtrato = await extratoOf(investidorToken);
    const credit = investorExtrato.find((e) => e.descricao.includes(duplicataId) && e.descricao.includes('vencimento'));
    expect(credit).toBeTruthy();
    expect(credit!.isPositive).toBe(true);
    expect(credit!.valorFmt.replace(/\D/g, '')).toBe('20000');

    // Idempotência: já paga, reportar de novo falha.
    const again = await request(app).post(`/api/aceites/${aceite.id}/pagamento`).set('Authorization', `Bearer ${sacadoToken}`);
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('not_eligible');
  });

  it('duplicata nunca vendida: o próprio cedente (credor atual) recebe o valor de face', async () => {
    const sacadoCompany = unique('Sacado Pagamento Cedente');
    const { token: sacadoToken } = await register('sacado', sacadoCompany);
    const { token: cedenteToken } = await register('cedente', unique('Cedente Pagamento Direto'));

    const emit = await emitirComRetry(cedenteToken, formCompleto(sacadoCompany, '8.000'));
    expect(emit.status).toBe(200);
    const duplicataId = emit.body.duplicataId as string;
    // Nunca disparado pro leilão — segue 'aprovada', o cedente ainda é o dono do recebível.

    const aceite = await findAceite(sacadoToken, duplicataId);
    expect(aceite.canReportPayment).toBe(true);

    const report = await request(app).post(`/api/aceites/${aceite.id}/pagamento`).set('Authorization', `Bearer ${sacadoToken}`);
    expect(report.status).toBe(200);

    const cedenteExtrato = await extratoOf(cedenteToken);
    const credit = cedenteExtrato.find((e) => e.descricao.includes(duplicataId) && e.descricao.includes('vencimento'));
    expect(credit).toBeTruthy();
    expect(credit!.isPositive).toBe(true);
    expect(credit!.valorFmt.replace(/\D/g, '')).toBe('8000');
  });

  it('duplicata financiada via Programa Confirming: o fundo é o credor — retorna ao pool (fundoRetornoDePagamento)', async () => {
    const sacadoCompany = unique('Sacado Pagamento Confirming');
    const { token: sacadoToken, userId: sacadoUserId } = await register('sacado', sacadoCompany);
    const { token: cedenteToken, userId: cedenteUserId } = await register('cedente', unique('Cedente Confirming Pagamento'));
    const { token: fundoInvestorToken } = await register('investidor', unique('Investidor Fundo Pagamento'));

    // CNPJ com histórico real seedado (data/seed.ts SACADOS) — necessário pra
    // buildBlendedRiscoViewSync calcular uma taxa (mesmo CNPJ usado em confirming.test.ts).
    const CNPJ_COM_HISTORICO = '12.345.678/0001-90';
    await request(app).post('/api/confirming/criar').set('Authorization', `Bearer ${sacadoToken}`).send({ cnpj: CNPJ_COM_HISTORICO, limite: '500.000' });
    await request(app).post('/api/confirming/membros').set('Authorization', `Bearer ${sacadoToken}`).send({ cedenteUserId });
    await request(app).post('/api/confirming-fundo/contribuir').set('Authorization', `Bearer ${fundoInvestorToken}`).send({ valor: 50000 });

    const balanceAfterAporte = getFundoBalance();
    const navAfterAporte = computeFundoNav();

    const emit = await emitirComRetry(cedenteToken, formCompleto(sacadoCompany, '10.000'));
    expect(emit.status).toBe(200);
    expect(emit.body.financiadoViaPrograma).toBe(true);
    const duplicataId = emit.body.duplicataId as string;

    // O fundo paga o preço com deságio (lib/marketCompute.ts's computePurchasePrice, na
    // taxa negociada do programa), não o valor de face — mesmo cálculo real que
    // lib/confirmingCore.ts's tentarFinanciarViaPrograma usa. Caixa cai só esse tanto; NAV
    // (caixa + posições em aberto, valorizadas ao valor de face) SOBE pelo valor do deságio
    // — um ganho ainda não realizado: o fundo trocou dinheiro por um direito a receber que
    // vale mais do que pagou por ele.
    const programa = getProgramaBySacado(sacadoUserId)!;
    const { precoCompra, descontoValor } = computePurchasePrice(getDuplicata(duplicataId)!, programa.taxa_am);
    expect(getFundoBalance()).toBeCloseTo(balanceAfterAporte - precoCompra, 6);
    expect(computeFundoNav()).toBeCloseTo(navAfterAporte + descontoValor, 5);

    const aceite = await findAceite(sacadoToken, duplicataId);
    expect(aceite.canReportPayment).toBe(true);

    const report = await request(app).post(`/api/aceites/${aceite.id}/pagamento`).set('Authorization', `Bearer ${sacadoToken}`);
    expect(report.status).toBe(200);

    // Retornou ao pool o valor de face cheio: caixa termina ACIMA do nível de antes do
    // financiamento (o ganho do deságio, agora realizado em caixa de verdade); NAV se
    // mantém no mesmo patamar de quando o ganho ainda era só uma posição em aberto.
    expect(getFundoBalance()).toBeCloseTo(balanceAfterAporte + descontoValor, 6);
    expect(computeFundoNav()).toBeCloseTo(navAfterAporte + descontoValor, 5);
  });
});

describe('Reportar pagamento no vencimento — bloqueios', () => {
  it('bloqueia quem não é sacado', async () => {
    const sacadoCompany = unique('Sacado Bloqueio Papel');
    const { token: sacadoToken } = await register('sacado', sacadoCompany);
    const { token: cedenteToken } = await register('cedente', unique('Cedente Bloqueio Papel'));
    const emit = await emitirComRetry(cedenteToken, formCompleto(sacadoCompany, '5.000'));
    const duplicataId = emit.body.duplicataId as string;
    const aceite = await findAceite(sacadoToken, duplicataId);

    const res = await request(app).post(`/api/aceites/${aceite.id}/pagamento`).set('Authorization', `Bearer ${cedenteToken}`);
    expect(res.status).toBe(403);
  });

  it('bloqueia um sacado reportando pagamento de uma duplicata de outra empresa', async () => {
    const sacadoCompany = unique('Sacado Dono');
    const { token: sacadoToken } = await register('sacado', sacadoCompany);
    const { token: outroSacadoToken } = await register('sacado', unique('Sacado Estranho'));
    const { token: cedenteToken } = await register('cedente', unique('Cedente Bloqueio Empresa'));
    const emit = await emitirComRetry(cedenteToken, formCompleto(sacadoCompany, '5.000'));
    const duplicataId = emit.body.duplicataId as string;
    const aceite = await findAceite(sacadoToken, duplicataId);

    const res = await request(app).post(`/api/aceites/${aceite.id}/pagamento`).set('Authorization', `Bearer ${outroSacadoToken}`);
    expect(res.status).toBe(403);
  });

  it('bloqueia enquanto houver disputa em aberto contra a duplicata', async () => {
    const sacadoCompany = unique('Sacado Disputa Pagamento');
    const { token: sacadoToken } = await register('sacado', sacadoCompany);
    const { token: cedenteToken } = await register('cedente', unique('Cedente Disputa Pagamento'));
    const emit = await emitirComRetry(cedenteToken, formCompleto(sacadoCompany, '5.000'));
    const duplicataId = emit.body.duplicataId as string;
    const aceite = await findAceite(sacadoToken, duplicataId);

    const contest = await request(app).post(`/api/aceites/${aceite.id}/status`).set('Authorization', `Bearer ${sacadoToken}`).send({ status: 'contestada' });
    expect(contest.status).toBe(200);

    const res = await request(app).post(`/api/aceites/${aceite.id}/pagamento`).set('Authorization', `Bearer ${sacadoToken}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('not_eligible');
  });
});
