import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { approveKyb, updateKybForm } from '../src/db/users.js';
import { fmtBRL, fmtBRLSigned } from '../src/lib/format.js';
import { platformFee } from '../src/lib/settlement.js';
import { computePurchasePrice } from '../src/lib/marketCompute.js';
import { getDuplicata } from '../src/db/duplicatas.js';

function parseBRL(s: string): number {
  return Number(s.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));
}

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function registerInvestidor() {
  const email = `inv-block-${unique()}@example.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Investidor', email, password: 'senha123', companyName: `Fundo ${unique()}`, role: 'investidor' });
  approveKyb(res.body.user.id);
  return { token: res.body.token as string, userId: res.body.user.id as number };
}

// A block trade buyer needs a declared patrimônio líquido above the institutional
// threshold (lib/blockTrade.ts INSTITUTIONAL_PL_THRESHOLD) — same KYB field every
// investidor account already fills in, just at a size that clears the bar.
async function registerInstitutionalBuyer() {
  const buyer = await registerInvestidor();
  updateKybForm(buyer.userId, 'pl', '15.000.000');
  return buyer;
}

// Emite sua própria duplicata (não depende do pool seedado compartilhado, que os testes
// de faixa de desconto/retorno abaixo esgotariam) com um valor de face conhecido, dispara
// pro leilão, compra e lista no secundário. askingValor é escolhido livremente pelo
// vendedor — createResaleListing não o limita pelo valor de face — usado pelos testes de
// faixa de desconto pra fazer o total varrido cair exatamente na faixa sendo testada.
async function sellerWithListing(askingValor: string, faceValor = '20.000') {
  const cedenteRes = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Cedente', email: `ced-block-${unique()}@example.com`, password: 'senha123', companyName: `Cedente Block ${unique()} Ltda`, role: 'cedente' });
  const cedenteToken = cedenteRes.body.token as string;
  const seller = await registerInvestidor();

  let duplicataId = '';
  for (let attempt = 0; attempt < 8 && !duplicataId; attempt++) {
    const res = await request(app)
      .post('/api/emitir/submit')
      .set('Authorization', `Bearer ${cedenteToken}`)
      .send({ sacado: `Sacado Block ${unique()} Ltda`, cnpj: '77.666.555/0001-44', valor: faceValor, vencimento: '2026-12-31', seguro: false, nfAnexada: true, batchValores: [] });
    if (res.status === 200) duplicataId = res.body.duplicataId;
  }
  const leilao = await request(app).post(`/api/minhas/${duplicataId}/leilao`).set('Authorization', `Bearer ${cedenteToken}`);
  if (leilao.status !== 200) throw new Error(`leilão falhou: ${JSON.stringify(leilao.body)}`);

  const precoCompra = computePurchasePrice(getDuplicata(duplicataId)!).precoCompra;
  await request(app).post(`/api/market/${duplicataId}/buy`).set('Authorization', `Bearer ${seller.token}`);
  const secundario = await request(app).get('/api/secundario').set('Authorization', `Bearer ${seller.token}`);
  const position = secundario.body.minhasPosicoes.find((p: { duplicataId: string }) => p.duplicataId === duplicataId);
  const listRes = await request(app)
    .post('/api/secundario/listar')
    .set('Authorization', `Bearer ${seller.token}`)
    .send({ purchaseId: position.purchaseId, askingValor });
  const listing = listRes.body.market.find((l: { duplicataId: string }) => l.duplicataId === duplicataId);
  return { seller, duplicataId, listingId: listing.id as number, precoCompra, faceValor: Number(faceValor.replace(/\./g, '')) };
}

describe('institutional block trade', () => {
  it('refuses a regular (non-institutional-PL) investor account', async () => {
    const buyer = await registerInvestidor(); // default KYB pl ('5.000.000' in defaultSettings) is below the threshold
    const res = await request(app).post('/api/secundario/block-trade').set('Authorization', `Bearer ${buyer.token}`).send({ valorMaximo: '1.000.000' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('not_institutional');
  });

  it('refuses a budget below the minimum block trade size', async () => {
    const buyer = await registerInstitutionalBuyer();
    const res = await request(app).post('/api/secundario/block-trade').set('Authorization', `Bearer ${buyer.token}`).send({ valorMaximo: '10.000' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
  });

  it('reports no_match when the criteria filter out every candidate', async () => {
    const buyer = await registerInstitutionalBuyer();
    // No real duplicata clears score 100 — a deliberately unmatchable filter, independent
    // of whatever listings happen to be active from other tests in this file.
    const res = await request(app).post('/api/secundario/block-trade').set('Authorization', `Bearer ${buyer.token}`).send({ valorMaximo: '1.000.000', scoreMin: 100 });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('no_match');
  });

  it('sweeps multiple active listings in one transaction, at each seller\'s exact posted price', async () => {
    const listingA = await sellerWithListing('180.000');
    const listingB = await sellerWithListing('150.000');
    const buyer = await registerInstitutionalBuyer();

    const res = await request(app).post('/api/secundario/block-trade').set('Authorization', `Bearer ${buyer.token}`).send({ valorMaximo: '2.000.000' });
    expect(res.status).toBe(200);
    expect(res.body.quantidade).toBeGreaterThanOrEqual(2);
    expect(res.body.itens.some((i: { duplicataId: string }) => i.duplicataId === listingA.duplicataId)).toBe(true);
    expect(res.body.itens.some((i: { duplicataId: string }) => i.duplicataId === listingB.duplicataId)).toBe(true);
    // Each seller receives exactly their posted asking price — the block trade discount
    // applies to the platform's own fee, never as a markdown on what a seller was owed.
    const itemA = res.body.itens.find((i: { duplicataId: string }) => i.duplicataId === listingA.duplicataId);
    const itemB = res.body.itens.find((i: { duplicataId: string }) => i.duplicataId === listingB.duplicataId);
    expect(itemA.valorFmt).toBe(fmtBRL(180000));
    expect(itemB.valorFmt).toBe(fmtBRL(150000));
    expect(res.body.descontoPct).toBeGreaterThan(0);

    // Both swept listings are gone from the market and each seller's own listing shows sold.
    expect(res.body.market.some((l: { id: number }) => l.id === listingA.listingId)).toBe(false);
    expect(res.body.market.some((l: { id: number }) => l.id === listingB.listingId)).toBe(false);
    const sellerAView = await request(app).get('/api/secundario').set('Authorization', `Bearer ${listingA.seller.token}`);
    expect(sellerAView.body.meusAnuncios.find((a: { id: number }) => a.id === listingA.listingId).status).toBe('vendido');

    // The buyer now holds both positions, and the block trade shows up in their history.
    const buyerView = await request(app).get('/api/secundario').set('Authorization', `Bearer ${buyer.token}`);
    expect(buyerView.body.minhasPosicoes.some((p: { duplicataId: string }) => p.duplicataId === listingA.duplicataId)).toBe(true);
    expect(buyerView.body.minhasPosicoes.some((p: { duplicataId: string }) => p.duplicataId === listingB.duplicataId)).toBe(true);
    expect(buyerView.body.meusBlockTrades).toHaveLength(1);
    expect(buyerView.body.meusBlockTrades[0].id).toBe(res.body.blockTradeId);
  });

  it('atualiza o retorno realizado do vendedor e credita o líquido do desconto — não o valor de face nem a taxa cheia', async () => {
    const listingA = await sellerWithListing('180.000', '200.000');
    const listingB = await sellerWithListing('150.000', '160.000');
    const buyer = await registerInstitutionalBuyer();

    const buyerBalBefore = await request(app).get('/api/account').set('Authorization', `Bearer ${buyer.token}`);
    const buyerDebitCountBefore = buyerBalBefore.body.extrato.length;

    const res = await request(app).post('/api/secundario/block-trade').set('Authorization', `Bearer ${buyer.token}`).send({ valorMaximo: '2.000.000' });
    expect(res.status).toBe(200);
    expect(res.body.descontoPct).toBe(10); // 180k+150k = 330k, abaixo de 1 milhão

    // Retorno realizado do vendedor A: líquido recebido (com o desconto institucional já
    // aplicado à taxa) menos o que ele pagou originalmente — mesma fórmula/arredondamento
    // de resale-retorno.test.ts, nunca o retorno "se tivesse segurado até o vencimento".
    const feeA = platformFee(180000) * (1 - res.body.descontoPct / 100);
    const netA = 180000 - feeA;
    const faceA = listingA.faceValor;
    const custoRecuperadoA = faceA - Math.round(faceA - listingA.precoCompra);
    const retornoRealEsperadoA = Math.round(netA - custoRecuperadoA);

    const historicoA = await request(app).get('/api/historico?pageSize=200').set('Authorization', `Bearer ${listingA.seller.token}`);
    const rowA = historicoA.body.historico.find((h: { investidoFmt: string }) => Math.round(parseBRL(h.investidoFmt)) === faceA);
    expect(rowA).toBeTruthy();
    expect(rowA.retornoFmt).toBe(fmtBRLSigned(retornoRealEsperadoA));

    // Crédito real no ledger do vendedor: líquido do desconto, estritamente MAIOR que se
    // não houvesse desconto nenhum — documenta o achado da varredura (o desconto
    // institucional aumenta o líquido do vendedor, não fica neutro como o comentário do
    // código promete) em vez de escondê-lo.
    const extratoA = await request(app).get('/api/account').set('Authorization', `Bearer ${listingA.seller.token}`);
    const creditA = extratoA.body.extrato.find((e: { descricao: string }) => e.descricao.includes(listingA.duplicataId) && e.isPositive);
    expect(creditA).toBeTruthy();
    expect(Math.round(parseBRL(creditA.valorFmt))).toBe(Math.round(netA));
    const netSemDesconto = 180000 - platformFee(180000);
    expect(Math.round(parseBRL(creditA.valorFmt))).toBeGreaterThan(Math.round(netSemDesconto));

    // Débito agregado do comprador: soma de todos os itens varridos no mesmo block trade,
    // não um débito por item isolado.
    const buyerBalAfter = await request(app).get('/api/account').set('Authorization', `Bearer ${buyer.token}`);
    const newDebits = buyerBalAfter.body.extrato.slice(0, buyerBalAfter.body.extrato.length - buyerDebitCountBefore);
    // valorFmt de um débito já vem com o "-" embutido (fmtBRL de negativo) — soma direta,
    // sem inverter o sinal de novo.
    const totalDebitado = Math.abs(
      newDebits.filter((e: { isPositive: boolean }) => !e.isPositive).reduce((s: number, e: { valorFmt: string }) => s + parseBRL(e.valorFmt), 0)
    );
    expect(Math.round(totalDebitado)).toBe(180000 + 150000);
  });

  it('respeita quantidadeMax — não varre mais anúncios do que o pedido mesmo com orçamento de sobra', async () => {
    await sellerWithListing('180.000');
    await sellerWithListing('150.000');
    const buyer = await registerInstitutionalBuyer();

    const res = await request(app)
      .post('/api/secundario/block-trade')
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({ valorMaximo: '2.000.000', quantidadeMax: 1 });
    // Um único item pode não bater o mínimo de block trade sozinho — nesse caso 409, o que
    // ainda prova que quantidadeMax é respeitado (não varreu os 2 pra compensar).
    if (res.status === 200) {
      expect(res.body.quantidade).toBe(1);
    } else {
      expect(res.status).toBe(409);
    }
  });

  it('supera um lance ativo numa posição que acabou de ser varrida pelo block trade', async () => {
    const { duplicataId, listingId } = await sellerWithListing('180.000');
    await sellerWithListing('150.000'); // só pra bater o mínimo de block trade junto com a de cima
    const bidder = await registerInvestidor();
    const bid = await request(app).post(`/api/secundario/${listingId}/lances`).set('Authorization', `Bearer ${bidder.token}`).send({ valor: '170.000' });
    expect(bid.status).toBe(200);
    // A rota devolve o payload completo do dashboard no sucesso (mesmo padrão de /listar),
    // não um { bidId } isolado — o id do lance vem de meusLances.
    const bidId = bid.body.meusLances[0].id as number;

    const buyer = await registerInstitutionalBuyer();
    const res = await request(app).post('/api/secundario/block-trade').set('Authorization', `Bearer ${buyer.token}`).send({ valorMaximo: '2.000.000' });
    expect(res.status).toBe(200);
    expect(res.body.itens.some((i: { duplicataId: string }) => i.duplicataId === duplicataId)).toBe(true);

    const bidderView = await request(app).get('/api/secundario').set('Authorization', `Bearer ${bidder.token}`);
    const myBid = bidderView.body.meusLances.find((b: { id: number }) => b.id === bidId);
    expect(myBid.status).not.toBe('ativo');
  });

  it.each([
    ['350.000', 10],
    ['1.200.000', 20],
    ['5.500.000', 30],
  ])('aplica o desconto certo por faixa de volume — %s de valor total varrido = %i%%', async (askingValor, descontoEsperado) => {
    // O preço de venda no anúncio é escolhido livremente pelo vendedor (createResaleListing
    // não limita askingValor pelo valor de face da duplicata subjacente) — usado aqui só
    // pra fazer o total varrido cair exatamente na faixa de desconto sendo testada, num
    // único anúncio, sem precisar de várias duplicatas seedadas grandes o bastante.
    const { listingId } = await sellerWithListing(askingValor);
    const buyer = await registerInstitutionalBuyer();
    const res = await request(app).post('/api/secundario/block-trade').set('Authorization', `Bearer ${buyer.token}`).send({ valorMaximo: '6.000.000' });
    expect(res.status).toBe(200);
    expect(res.body.itens.length).toBeGreaterThan(0);
    expect(res.body.descontoPct).toBe(descontoEsperado);
    expect(res.body.market.some((l: { id: number }) => l.id === listingId)).toBe(false);
  });

  it('a block trade buyer cannot sweep their own listing', async () => {
    const { seller, duplicataId, listingId } = await sellerWithListing('180.000');
    updateKybForm(seller.userId, 'pl', '15.000.000');
    const res = await request(app).post('/api/secundario/block-trade').set('Authorization', `Bearer ${seller.token}`).send({ valorMaximo: '1.000.000' });
    // Own listing is excluded from candidates — either genuinely no other match exists at
    // all (409), or it succeeds while still never including their own listing.
    if (res.status === 200) {
      expect(res.body.itens.some((i: { duplicataId: string }) => i.duplicataId === duplicataId)).toBe(false);
      const sellerView = await request(app).get('/api/secundario').set('Authorization', `Bearer ${seller.token}`);
      expect(sellerView.body.meusAnuncios.find((a: { id: number }) => a.id === listingId).status).toBe('ativo');
    } else {
      expect(res.status).toBe(409);
    }
  });
});
