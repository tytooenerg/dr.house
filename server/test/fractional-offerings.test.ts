import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { approveKyb } from '../src/db/users.js';
import { createDuplicata, getDuplicata } from '../src/db/duplicatas.js';
import { ensureAceite, setAceiteStatus } from '../src/db/aceites.js';
import { FRACTIONAL_MIN_VALOR, FRACTIONAL_TOTAL_TOKENS } from '../src/lib/fractionalOfferings.js';
import { computePurchasePrice } from '../src/lib/marketCompute.js';
import { arrematar, darLance, fecharLeiloes } from './helpers/auction.js';

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function registerInvestidor() {
  const email = `inv-frac-${unique()}@example.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Investidor', email, password: 'senha123', companyName: `Fundo ${unique()}`, role: 'investidor' });
  approveKyb(res.body.user.id);
  return { token: res.body.token as string, userId: res.body.user.id as number };
}

// Achado corrigido: fracionar/comprar exige aceite confirmado — createDuplicata sozinho
// não cria nenhum registro de aceite, então toda duplicata criada direto aqui (sem passar
// pela rota HTTP de emissão) precisa do aceite avançado manualmente pro estado 'aceita'
// pra continuar elegível.
function makeLargeDuplicata(valor = 300000) {
  const d = createDuplicata({
    cedenteId: null,
    cedenteNome: 'Cedente Grande Ltda',
    sacadoNome: 'Fractional Test Sacado',
    sacadoCnpj: '',
    valor,
    vencimento: '2026-12-31',
    emissao: '10/08/2026',
    status: 'aprovada',
    lastroPct: 100,
    seguro: false,
  });
  const aceite = ensureAceite(d.id, 'Aceite confirmado na emissão');
  setAceiteStatus(aceite.id, 'aceita');
  return d;
}

async function registerCedente(companyName: string) {
  const email = `ced-frac-${unique()}@example.com`;
  const res = await request(app).post('/api/auth/register').send({ nome: 'Cedente', email, password: 'senha123', companyName, role: 'cedente' });
  return { token: res.body.token as string, userId: res.body.user.id as number };
}

async function registerSacado(companyName: string) {
  const email = `sac-frac-${unique()}@example.com`;
  const res = await request(app).post('/api/auth/register').send({ nome: 'Sacado', email, password: 'senha123', companyName, role: 'sacado' });
  return { token: res.body.token as string };
}

async function findAceite(sacadoToken: string, duplicataId: string) {
  const res = await request(app).get('/api/aceites').set('Authorization', `Bearer ${sacadoToken}`);
  return res.body.aceites.find((a: { duplicataId: string }) => a.duplicataId === duplicataId);
}

describe('Fractional offerings — eligibility', () => {
  it('rejects a duplicata below the value threshold', async () => {
    const { token } = await registerInvestidor();
    const d = makeLargeDuplicata(FRACTIONAL_MIN_VALOR - 1000);
    const res = await request(app).post(`/api/market/${d.id}/fracionar`).set('Authorization', `Bearer ${token}`).send({ tokens: 1 });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('not_eligible');
  });

  it('GET /:id/fracionamento reports eligibility and a null offering before any purchase', async () => {
    const { token } = await registerInvestidor();
    const d = makeLargeDuplicata();
    const res = await request(app).get(`/api/market/${d.id}/fracionamento`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.eligible).toBe(true);
    expect(res.body.offering).toBeNull();
  });
});

describe('Fractional offerings — real multi-investor allocation', () => {
  it('two different investors can each buy a real slice of the same large duplicata', async () => {
    const d = makeLargeDuplicata(300000); // token = 3.000
    const investorA = await registerInvestidor();
    const investorB = await registerInvestidor();

    const buyA = await request(app).post(`/api/market/${d.id}/fracionar`).set('Authorization', `Bearer ${investorA.token}`).send({ tokens: 20 });
    expect(buyA.status).toBe(200);
    expect(buyA.body.offering.tokensVendidos).toBe(20);
    expect(buyA.body.offering.status).toBe('aberta');

    const buyB = await request(app).post(`/api/market/${d.id}/fracionar`).set('Authorization', `Bearer ${investorB.token}`).send({ tokens: 30 });
    expect(buyB.status).toBe(200);
    expect(buyB.body.offering.tokensVendidos).toBe(50);
    expect(buyB.body.offering.holdersCount).toBe(2);

    const holdingsA = await request(app).get('/api/market/minhas-cotas').set('Authorization', `Bearer ${investorA.token}`);
    expect(holdingsA.body.holdings).toHaveLength(1);
    expect(holdingsA.body.holdings[0].tokens).toBe(20);
    expect(holdingsA.body.holdings[0].pctPosicao).toBe(20);
  });

  it('rejects buying more tokens than are actually still available', async () => {
    const d = makeLargeDuplicata(200000);
    const { token } = await registerInvestidor();
    await request(app).post(`/api/market/${d.id}/fracionar`).set('Authorization', `Bearer ${token}`).send({ tokens: 90 });
    const res = await request(app).post(`/api/market/${d.id}/fracionar`).set('Authorization', `Bearer ${token}`).send({ tokens: 20 });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('insufficient_tokens');
  });

  it('completing the offering (100 tokens) marks the duplicata vendida and blocks a whole purchase', async () => {
    const d = makeLargeDuplicata(200000);
    const buyer = await registerInvestidor();
    const wholeHunter = await registerInvestidor();
    const full = await request(app).post(`/api/market/${d.id}/fracionar`).set('Authorization', `Bearer ${buyer.token}`).send({ tokens: 100 });
    expect(full.status).toBe(200);
    expect(full.body.offering.status).toBe('concluida');
    expect(full.body.offering.pctVendido).toBe(100);

    const wholeBuy = (await arrematar(wholeHunter.token, d.id)).lance;
    expect(wholeBuy.status).toBe(409);
    expect(wholeBuy.body.error).toBe('already_purchased');
  });

  it('a duplicata already bought whole cannot then be fractionalized', async () => {
    const d = makeLargeDuplicata(200000);
    const wholeBuyer = await registerInvestidor();
    const wholeBuy = (await arrematar(wholeBuyer.token, d.id)).lance;
    expect(wholeBuy.status).toBe(200);

    const fractionalHopeful = await registerInvestidor();
    const res = await request(app).post(`/api/market/${d.id}/fracionar`).set('Authorization', `Bearer ${fractionalHopeful.token}`).send({ tokens: 5 });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('not_eligible');
  });

  it('a fractional purchase debits the investor and credits the cedente net of the platform fee, real ledger entries', async () => {
    const d = makeLargeDuplicata(300000);
    const buyer = await registerInvestidor();
    // O preço real pago tem deságio aplicado (lib/marketCompute.ts's computePurchasePrice,
    // mesma fórmula da compra integral) — 10 tokens de uma duplicata de 300.000 vale menos
    // que 30.000 de face, nunca o valor de face cheio (o bug original: pagar o valor de
    // face inteiro por um token dava retorno zero ao investidor no vencimento).
    const { precoCompra } = computePurchasePrice(getDuplicata(d.id)!);
    const precoEsperado10Tokens = Math.round((precoCompra / FRACTIONAL_TOTAL_TOKENS) * 10);

    const res = await request(app).post(`/api/market/${d.id}/fracionar`).set('Authorization', `Bearer ${buyer.token}`).send({ tokens: 10 });
    expect(res.status).toBe(200);
    expect(res.body.valorInvestidoFmt.replace(/\D/g, '')).toBe(String(precoEsperado10Tokens));
    expect(precoEsperado10Tokens).toBeLessThan(30000); // menor que o valor de face — o deságio foi de fato aplicado

    const extrato = await request(app).get('/api/account').set('Authorization', `Bearer ${buyer.token}`);
    const debit = extrato.body.extrato.find((e: { descricao: string }) => e.descricao.includes(d.id));
    expect(debit).toBeTruthy();
    expect(debit.isPositive).toBe(false);
    expect(debit.valorFmt.replace(/\D/g, '')).toBe(String(precoEsperado10Tokens));
  });

  it('o ganho mostrado por holding é real e determinístico, não mais um número fabricado por Math.random()', async () => {
    const d = makeLargeDuplicata(300000);
    const investorA = await registerInvestidor();
    const investorB = await registerInvestidor();

    // Duas compras da mesma quantidade de tokens, na mesma duplicata, quase no mesmo
    // instante — antes da correção, o "retorno" de cada uma era Math.random() e
    // praticamente nunca coincidia; agora é sempre o mesmo deságio real capturado.
    await request(app).post(`/api/market/${d.id}/fracionar`).set('Authorization', `Bearer ${investorA.token}`).send({ tokens: 15 });
    await request(app).post(`/api/market/${d.id}/fracionar`).set('Authorization', `Bearer ${investorB.token}`).send({ tokens: 15 });

    const holdingsA = await request(app).get('/api/market/minhas-cotas').set('Authorization', `Bearer ${investorA.token}`);
    const holdingsB = await request(app).get('/api/market/minhas-cotas').set('Authorization', `Bearer ${investorB.token}`);
    expect(holdingsA.body.holdings[0].retornoFmt).toBe(holdingsB.body.holdings[0].retornoFmt);
    expect(holdingsA.body.holdings[0].retornoFmt).not.toBe('+R$ 0');
  });
});

describe('Fractional offerings — pagamento no vencimento distribuído entre os holders', () => {
  it('cada holder recebe o valor de face dos seus tokens; o cedente NÃO é pago de novo (já recebeu na venda)', async () => {
    const sacadoCompany = unique('Sacado Fracionado Pagamento');
    const { token: sacadoToken } = await registerSacado(sacadoCompany);
    const cedente = await registerCedente(unique('Cedente Fracionado Pagamento'));
    const d = createDuplicata({
      cedenteId: cedente.userId,
      cedenteNome: 'Cedente Fracionado Pagamento',
      sacadoNome: sacadoCompany,
      sacadoCnpj: '',
      valor: 300000,
      vencimento: '2026-12-31',
      emissao: '10/08/2026',
      status: 'aprovada',
      lastroPct: 100,
      seguro: false,
    });
    setAceiteStatus(ensureAceite(d.id, '15 dias úteis restantes').id, 'aceita');

    const investorA = await registerInvestidor(); // vai comprar 60 tokens
    const investorB = await registerInvestidor(); // vai comprar 40 tokens
    await request(app).post(`/api/market/${d.id}/fracionar`).set('Authorization', `Bearer ${investorA.token}`).send({ tokens: 60 });
    const buyB = await request(app).post(`/api/market/${d.id}/fracionar`).set('Authorization', `Bearer ${investorB.token}`).send({ tokens: 40 });
    expect(buyB.body.offering.status).toBe('concluida');

    const aceite = await findAceite(sacadoToken, d.id);
    expect(aceite).toBeTruthy();
    const report = await request(app).post(`/api/aceites/${aceite.id}/pagamento`).set('Authorization', `Bearer ${sacadoToken}`);
    expect(report.status).toBe(200);

    const tokenValor = 300000 / FRACTIONAL_TOTAL_TOKENS;

    const extratoA = await request(app).get('/api/account').set('Authorization', `Bearer ${investorA.token}`);
    const creditA = extratoA.body.extrato.find((e: { descricao: string }) => e.descricao.includes(d.id) && e.descricao.includes('vencimento'));
    expect(creditA).toBeTruthy();
    expect(creditA.isPositive).toBe(true);
    expect(creditA.valorFmt.replace(/\D/g, '')).toBe(String(Math.round(tokenValor * 60)));

    const extratoB = await request(app).get('/api/account').set('Authorization', `Bearer ${investorB.token}`);
    const creditB = extratoB.body.extrato.find((e: { descricao: string }) => e.descricao.includes(d.id) && e.descricao.includes('vencimento'));
    expect(creditB).toBeTruthy();
    expect(creditB.valorFmt.replace(/\D/g, '')).toBe(String(Math.round(tokenValor * 40)));

    // O cedente já recebeu na venda dos tokens (liquidação fracionada) — não pode receber
    // de novo o valor de face inteiro só porque o sacado pagou (esse era o bug: antes
    // currentCreditorFor não sabia da existência do fracionamento e caía nesse fallback,
    // pagando o cedente uma segunda vez enquanto os holders reais não recebiam nada).
    const extratoCedente = await request(app).get('/api/account').set('Authorization', `Bearer ${cedente.token}`);
    const pagamentoIndevido = extratoCedente.body.extrato.find(
      (e: { descricao: string }) => e.descricao.includes(d.id) && e.descricao.includes('vencimento')
    );
    expect(pagamentoIndevido).toBeUndefined();

    expect(getDuplicata(d.id)!.status).toBe('paga');
  });

  it('oferta parcialmente vendida: o cedente recebe no vencimento pela fração de tokens que nunca vendeu', async () => {
    const sacadoCompany = unique('Sacado Fracionado Parcial');
    const { token: sacadoToken } = await registerSacado(sacadoCompany);
    const cedente = await registerCedente(unique('Cedente Fracionado Parcial'));
    const d = createDuplicata({
      cedenteId: cedente.userId,
      cedenteNome: 'Cedente Fracionado Parcial',
      sacadoNome: sacadoCompany,
      sacadoCnpj: '',
      valor: 200000,
      vencimento: '2026-12-31',
      emissao: '10/08/2026',
      status: 'aprovada',
      lastroPct: 100,
      seguro: false,
    });
    setAceiteStatus(ensureAceite(d.id, '15 dias úteis restantes').id, 'aceita');

    const investor = await registerInvestidor();
    // Só 40 dos 100 tokens vendidos — a oferta fica 'aberta', a duplicata nunca vira
    // 'vendida'. Os outros 60 tokens continuam sendo do cedente até ele vendê-los.
    const buy = await request(app).post(`/api/market/${d.id}/fracionar`).set('Authorization', `Bearer ${investor.token}`).send({ tokens: 40 });
    expect(buy.body.offering.status).toBe('aberta');

    const aceite = await findAceite(sacadoToken, d.id);
    const report = await request(app).post(`/api/aceites/${aceite.id}/pagamento`).set('Authorization', `Bearer ${sacadoToken}`);
    expect(report.status).toBe(200);

    const tokenValor = 200000 / FRACTIONAL_TOTAL_TOKENS;

    const extratoInvestor = await request(app).get('/api/account').set('Authorization', `Bearer ${investor.token}`);
    const creditInvestor = extratoInvestor.body.extrato.find((e: { descricao: string }) => e.descricao.includes(d.id) && e.descricao.includes('vencimento'));
    expect(creditInvestor.valorFmt.replace(/\D/g, '')).toBe(String(Math.round(tokenValor * 40)));

    const extratoCedente = await request(app).get('/api/account').set('Authorization', `Bearer ${cedente.token}`);
    const creditCedente = extratoCedente.body.extrato.find((e: { descricao: string }) => e.descricao.includes(d.id) && e.descricao.includes('vencimento'));
    expect(creditCedente).toBeTruthy();
    expect(creditCedente.isPositive).toBe(true);
    expect(creditCedente.valorFmt.replace(/\D/g, '')).toBe(String(Math.round(tokenValor * 60)));
  });
});
