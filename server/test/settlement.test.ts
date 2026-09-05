import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { approveKyb } from '../src/db/users.js';
import { platformFee, platformFeePct } from '../src/lib/settlement.js';
import { computePurchasePrice } from '../src/lib/marketCompute.js';
import { getDuplicata } from '../src/db/duplicatas.js';
import { getAceiteByDuplicata, setAceiteStatus } from '../src/db/aceites.js';
import { arrematar, darLance, fecharLeiloes } from './helpers/auction.js';

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// Achado corrigido (usuário): uma duplicata só pode ser leiloada/comprada depois que o
// sacado aceita (explícito ou tácito) — routes/minhas.ts's dispararLeilao agora exige
// isso. Direto no banco, mesmo padrão já usado pra simular aceite tácito — o objetivo
// aqui é só destravar o leilão, não testar o fluxo de aceite em si (já coberto em
// outros arquivos).
function aceitarDuplicata(duplicataId: string) {
  const aceite = getAceiteByDuplicata(duplicataId);
  if (aceite) setAceiteStatus(aceite.id, 'aceita');
}

async function registerInvestidor() {
  const email = `inv-settle-${unique()}@example.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Investidor', email, password: 'senha123', companyName: `Fundo ${unique()}`, role: 'investidor' });
  approveKyb(res.body.user.id);
  return { token: res.body.token as string, userId: res.body.user.id as number };
}

describe('platformFeePct / platformFee', () => {
  it('is tiered by volume, matching the Emitir preview', () => {
    expect(platformFeePct(50_000)).toBeCloseTo(0.0035);
    expect(platformFeePct(500_000)).toBeCloseTo(0.003);
    expect(platformFeePct(2_000_000)).toBeCloseTo(0.0025);
    expect(platformFee(100_000)).toBeCloseTo(350);
  });
});

describe('real settlement on a marketplace purchase', () => {
  it('debits the full purchase amount from the investor ledger', async () => {
    const investor = await registerInvestidor();
    const market = await request(app).get('/api/market').set('Authorization', `Bearer ${investor.token}`);
    const buyable = market.body.offers.find((o: { canBuy: boolean }) => o.canBuy);
    expect(buyable).toBeTruthy();

    (await arrematar(investor.token, buyable.id)).lance;

    const investorExtrato = await request(app).get('/api/account').set('Authorization', `Bearer ${investor.token}`);
    const debit = investorExtrato.body.extrato.find((e: { descricao: string }) => e.descricao.includes(buyable.id));
    expect(debit).toBeTruthy();
    expect(debit.isPositive).toBe(false);
  });

  it('deducts the fee from the emissor cedente when a fresh cedente-emitted duplicata is purchased', async () => {
    const cedenteEmail = `ced-settle-${unique()}@example.com`;
    const cedenteReg = await request(app)
      .post('/api/auth/register')
      .send({ nome: 'Cedente', email: cedenteEmail, password: 'senha123', companyName: `Cedente ${unique()}`, role: 'cedente' });
    const cedenteToken = cedenteReg.body.token as string;

    let duplicataId = '';
    for (let attempt = 0; attempt < 8 && !duplicataId; attempt++) {
      const res = await request(app)
        .post('/api/emitir/submit')
        .set('Authorization', `Bearer ${cedenteToken}`)
        .send({ sacado: 'Grupo Atlas Varejo', cnpj: '', valor: '10.000', vencimento: '2026-12-31', seguro: false, nfAnexada: true });
      if (res.status === 200) duplicataId = res.body.duplicataId;
    }
    expect(duplicataId).not.toBe('');

    // The freshly-emitted duplicata isn't 'no_mercado' yet (needs the leilão disparado
    // via /api/minhas/:id/leilao) — dispatch it so the marketplace lists it for purchase.
    aceitarDuplicata(duplicataId);
    await request(app).post(`/api/minhas/${duplicataId}/leilao`).set('Authorization', `Bearer ${cedenteToken}`);

    const investor = await registerInvestidor();
    // The real deságio-adjusted price this specific duplicata will actually be bought at
    // (lib/marketCompute.ts's computePurchasePrice — the same function the buy route
    // itself calls), always <= the R$10.000 face value — not a number this test should
    // hardcode or recompute independently.
    const { precoCompra } = computePurchasePrice(getDuplicata(duplicataId)!);
    expect(precoCompra).toBeLessThanOrEqual(10_000);

    const buyRes = (await arrematar(investor.token, duplicataId)).lance;
    expect(buyRes.status).toBe(200);

    const fee = platformFee(10_000);
    const expectedNet = precoCompra - fee;

    const cedenteExtrato = await request(app).get('/api/account').set('Authorization', `Bearer ${cedenteToken}`);
    const credit = cedenteExtrato.body.extrato.find((e: { descricao: string }) => e.descricao.includes(duplicataId));
    expect(credit).toBeTruthy();
    expect(credit.isPositive).toBe(true);
    expect(credit.descricao).toContain('taxa de plataforma');
    expect(credit.valorFmt.replace(/\D/g, '')).toBe(String(Math.round(expectedNet)));

    const investorExtrato = await request(app).get('/api/account').set('Authorization', `Bearer ${investor.token}`);
    const debit = investorExtrato.body.extrato.find((e: { descricao: string }) => e.descricao.includes(duplicataId));
    expect(debit).toBeTruthy();
    expect(debit.isPositive).toBe(false);
    expect(debit.valorFmt.replace(/\D/g, '')).toBe(String(Math.round(precoCompra)));
  });

  it('registra em purchases.retorno o deságio real e determinístico — não mais Math.round(valor * (0.02 + Math.random() * 0.02))', async () => {
    const cedenteEmail = `ced-settle-${unique()}@example.com`;
    const cedenteReg = await request(app)
      .post('/api/auth/register')
      .send({ nome: 'Cedente', email: cedenteEmail, password: 'senha123', companyName: `Cedente ${unique()}`, role: 'cedente' });
    const cedenteToken = cedenteReg.body.token as string;

    let duplicataId = '';
    for (let attempt = 0; attempt < 8 && !duplicataId; attempt++) {
      const res = await request(app)
        .post('/api/emitir/submit')
        .set('Authorization', `Bearer ${cedenteToken}`)
        .send({ sacado: 'Grupo Atlas Varejo', cnpj: '', valor: '20.000', vencimento: '2026-12-31', seguro: false, nfAnexada: true });
      if (res.status === 200) duplicataId = res.body.duplicataId;
    }
    expect(duplicataId).not.toBe('');
    aceitarDuplicata(duplicataId);
    await request(app).post(`/api/minhas/${duplicataId}/leilao`).set('Authorization', `Bearer ${cedenteToken}`);

    const { precoCompra } = computePurchasePrice(getDuplicata(duplicataId)!);
    const retornoEsperado = Math.round(20000 - precoCompra);

    const investor = await registerInvestidor();
    const buy = (await arrematar(investor.token, duplicataId)).lance;
    expect(buy.status).toBe(200);

    // "Investido" é o preço realmente pago (achado corrigido: usava valor de face, 20000,
    // direto — este era exatamente o bug), não mais o valor de face da duplicata.
    const historico = await request(app).get('/api/historico?pageSize=100').set('Authorization', `Bearer ${investor.token}`);
    const row = historico.body.historico.find((h: { empresa: string; investidoFmt: string }) => h.investidoFmt.replace(/\D/g, '') === String(Math.round(precoCompra)));
    expect(row).toBeTruthy();
    expect(row.retornoFmt.replace(/\D/g, '')).toBe(String(retornoEsperado));

    // Duas compras diferentes de duplicatas equivalentes (mesmo prazo/rating) devem gerar o
    // mesmo retorno — antes, cada uma tinha o seu próprio número aleatório e praticamente
    // nunca coincidiam.
    let duplicataId2 = '';
    for (let attempt = 0; attempt < 8 && !duplicataId2; attempt++) {
      const res = await request(app)
        .post('/api/emitir/submit')
        .set('Authorization', `Bearer ${cedenteToken}`)
        .send({ sacado: 'Grupo Atlas Varejo', cnpj: '', valor: '20.000', vencimento: '2026-12-31', seguro: false, nfAnexada: true });
      if (res.status === 200) duplicataId2 = res.body.duplicataId;
    }
    aceitarDuplicata(duplicataId2);
    await request(app).post(`/api/minhas/${duplicataId2}/leilao`).set('Authorization', `Bearer ${cedenteToken}`);
    const buy2 = (await arrematar(investor.token, duplicataId2)).lance;
    expect(buy2.status).toBe(200);

    // Mesmo preço de compra determinístico pras duas (mesmo prazo/rating) — daí o mesmo
    // "Investido" real, não o valor de face 20000 usado antes da correção.
    const historico2 = await request(app).get('/api/historico?pageSize=100').set('Authorization', `Bearer ${investor.token}`);
    const investidoEsperado = String(Math.round(precoCompra));
    const rowsEquivalentes = historico2.body.historico.filter((h: { investidoFmt: string }) => h.investidoFmt.replace(/\D/g, '') === investidoEsperado);
    expect(rowsEquivalentes).toHaveLength(2);
    expect(rowsEquivalentes[0].retornoFmt).toBe(rowsEquivalentes[1].retornoFmt);
  });
});

describe('real settlement on a mercado secundário resale', () => {
  it('deducts the fee from the reselling investor, not the original cedente', async () => {
    const seller = await registerInvestidor();
    const market = await request(app).get('/api/market').set('Authorization', `Bearer ${seller.token}`);
    const buyable = market.body.offers.find((o: { canBuy: boolean }) => o.canBuy);
    (await arrematar(seller.token, buyable.id)).lance;

    const secundario = await request(app).get('/api/secundario').set('Authorization', `Bearer ${seller.token}`);
    const position = secundario.body.minhasPosicoes.find((p: { duplicataId: string }) => p.duplicataId === buyable.id);
    const listRes = await request(app)
      .post('/api/secundario/listar')
      .set('Authorization', `Bearer ${seller.token}`)
      .send({ purchaseId: position.purchaseId, askingValor: '2.000' });
    const listing = listRes.body.market.find((l: { duplicataId: string }) => l.duplicataId === buyable.id);

    const buyer = await registerInvestidor();
    await request(app).post(`/api/secundario/${listing.id}/comprar`).set('Authorization', `Bearer ${buyer.token}`);

    const fee = platformFee(2000);
    const expectedNet = 2000 - fee;

    const sellerExtrato = await request(app).get('/api/account').set('Authorization', `Bearer ${seller.token}`);
    const credit = sellerExtrato.body.extrato.find((e: { descricao: string }) => e.descricao.includes('mercado secundário') && e.isPositive);
    expect(credit).toBeTruthy();
    expect(credit.valorFmt.replace(/\D/g, '')).toBe(String(Math.round(expectedNet)));

    const buyerExtrato = await request(app).get('/api/account').set('Authorization', `Bearer ${buyer.token}`);
    const debit = buyerExtrato.body.extrato.find((e: { descricao: string }) => e.descricao.includes('mercado secundário') && !e.isPositive);
    expect(debit).toBeTruthy();
    expect(debit.valorFmt.replace(/\D/g, '')).toBe('2000');
  });

  // Achado não coberto por nenhum teste até agora: depois de uma revenda, quem tem que
  // receber o valor de face no vencimento é quem comprou por último (currentCreditorFor),
  // não o comprador original — o teste acima só checa a liquidação da própria revenda,
  // nunca chega até o pagamento no vencimento.
  it('credita quem detém a posição no vencimento — o comprador original de uma duplicata revendida não recebe nada', async () => {
    const sacadoCompany = `Sacado Revenda ${unique()} Ltda`;
    const sacadoRes = await request(app)
      .post('/api/auth/register')
      .send({ nome: 'Sacado', email: `sac-resale-${unique()}@example.com`, password: 'senha123', companyName: sacadoCompany, role: 'sacado' });
    const sacadoToken = sacadoRes.body.token as string;

    const cedenteReg = await request(app)
      .post('/api/auth/register')
      .send({ nome: 'Cedente', email: `ced-resale-${unique()}@example.com`, password: 'senha123', companyName: `Cedente Revenda ${unique()}`, role: 'cedente' });
    const cedenteToken = cedenteReg.body.token as string;

    let duplicataId = '';
    for (let attempt = 0; attempt < 8 && !duplicataId; attempt++) {
      const res = await request(app)
        .post('/api/emitir/submit')
        .set('Authorization', `Bearer ${cedenteToken}`)
        .send({ sacado: sacadoCompany, cnpj: '', valor: '18.000', vencimento: '2026-12-31', seguro: false, nfAnexada: true });
      if (res.status === 200) duplicataId = res.body.duplicataId;
    }
    expect(duplicataId).toBeTruthy();
    aceitarDuplicata(duplicataId);
    await request(app).post(`/api/minhas/${duplicataId}/leilao`).set('Authorization', `Bearer ${cedenteToken}`);

    const originalBuyer = await registerInvestidor();
    const buy = (await arrematar(originalBuyer.token, duplicataId)).lance;
    expect(buy.status).toBe(200);

    const secundario = await request(app).get('/api/secundario').set('Authorization', `Bearer ${originalBuyer.token}`);
    const position = secundario.body.minhasPosicoes.find((p: { duplicataId: string }) => p.duplicataId === duplicataId);
    expect(position).toBeTruthy();
    const listRes = await request(app)
      .post('/api/secundario/listar')
      .set('Authorization', `Bearer ${originalBuyer.token}`)
      .send({ purchaseId: position.purchaseId, askingValor: '18.500' });
    const listing = listRes.body.market.find((l: { duplicataId: string }) => l.duplicataId === duplicataId);
    expect(listing).toBeTruthy();

    const newBuyer = await registerInvestidor();
    const resaleBuy = await request(app).post(`/api/secundario/${listing.id}/comprar`).set('Authorization', `Bearer ${newBuyer.token}`);
    expect(resaleBuy.status).toBe(200);

    const aceites = await request(app).get('/api/aceites').set('Authorization', `Bearer ${sacadoToken}`);
    const aceite = aceites.body.aceites.find((a: { duplicataId?: string; duplicata_id?: string }) => (a.duplicataId ?? a.duplicata_id) === duplicataId);
    expect(aceite).toBeTruthy();

    const originalBuyerExtratoBefore = await request(app).get('/api/account').set('Authorization', `Bearer ${originalBuyer.token}`);
    const originalBuyerCountBefore = originalBuyerExtratoBefore.body.extrato.length;

    const pay = await request(app).post(`/api/aceites/${aceite.id}/pagamento`).set('Authorization', `Bearer ${sacadoToken}`);
    expect(pay.status).toBe(200);

    // Comprador original: nenhum lançamento novo no vencimento — já vendeu a posição.
    const originalBuyerExtratoAfter = await request(app).get('/api/account').set('Authorization', `Bearer ${originalBuyer.token}`);
    expect(originalBuyerExtratoAfter.body.extrato.length).toBe(originalBuyerCountBefore);

    // Comprador atual (quem arrematou na revenda): recebe o valor de face integral.
    const newBuyerExtrato = await request(app).get('/api/account').set('Authorization', `Bearer ${newBuyer.token}`);
    const credit = newBuyerExtrato.body.extrato.find(
      (e: { descricao: string; isPositive: boolean }) => e.descricao.includes(duplicataId) && e.descricao.includes('vencimento')
    );
    expect(credit).toBeTruthy();
    expect(credit.isPositive).toBe(true);
    expect(credit.valorFmt.replace(/\D/g, '')).toBe('18000');
  });
});
