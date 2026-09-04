import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { approveKyb } from '../src/db/users.js';
import { platformFee } from '../src/lib/settlement.js';
import { computePurchasePrice } from '../src/lib/marketCompute.js';
import { getDuplicata } from '../src/db/duplicatas.js';
import { getAceiteByDuplicata, setAceiteStatus } from '../src/db/aceites.js';
import { fmtBRLSigned } from '../src/lib/format.js';

// Achado ao simular o mercado secundário de ponta a ponta: revender uma posição antes do
// vencimento nunca atualizava purchases.retorno da linha original do vendedor — ela
// continuava com o retorno "se tivesse segurado até o vencimento" (calculado na hora da
// compra), nunca o ganho real que o vendedor efetivamente recebeu ao sair da posição mais
// cedo. Esse número alimenta Carteira & Histórico, Performance institucional, o relatório
// PDF institucional, o Informe de Rendimentos e o gerador de DARF — 5 lugares mostrando
// (ou usando pra calcular imposto) um valor que o investidor nunca recebeu de verdade.

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function parseBRL(s: string): number {
  return Number(s.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));
}

async function registerInvestidor() {
  const email = `inv-resale-ret-${unique()}@example.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Investidor', email, password: 'senha123', companyName: `Fundo ${unique()}`, role: 'investidor' });
  approveKyb(res.body.user.id);
  return { token: res.body.token as string, userId: res.body.user.id as number };
}

// Emite uma duplicata com CNPJ real (100% do checklist de lastro) e um investidor a compra
// de primeira mão — retorna o id da duplicata e o precoCompra real pago (base de custo do
// vendedor pra checagem de retorno depois).
async function emitirEComprar(valor: string, buyer: { token: string }) {
  const cedenteRes = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Cedente', email: `ced-resale-ret-${unique()}@example.com`, password: 'senha123', companyName: `Cedente Revenda Ret ${unique()} Ltda`, role: 'cedente' });
  const cedenteToken = cedenteRes.body.token as string;

  let duplicataId = '';
  for (let attempt = 0; attempt < 8 && !duplicataId; attempt++) {
    const res = await request(app)
      .post('/api/emitir/submit')
      .set('Authorization', `Bearer ${cedenteToken}`)
      .send({ sacado: `Sacado Revenda Ret ${unique()} Ltda`, cnpj: '55.444.333/0001-22', valor, vencimento: '2026-12-31', seguro: false, nfAnexada: true, batchValores: [] });
    if (res.status === 200) duplicataId = res.body.duplicataId;
  }
  expect(duplicataId).toBeTruthy();

  const precoCompra = computePurchasePrice(getDuplicata(duplicataId)!).precoCompra;
  setAceiteStatus(getAceiteByDuplicata(duplicataId)!.id, 'aceita');
  const buy = await request(app).post(`/api/market/${duplicataId}/buy`).set('Authorization', `Bearer ${buyer.token}`);
  expect(buy.status).toBe(200);

  return { duplicataId, precoCompra };
}

async function historicoRowFor(token: string, investidoValor: number) {
  const res = await request(app).get('/api/historico?pageSize=200').set('Authorization', `Bearer ${token}`);
  return res.body.historico.find((h: { investidoFmt: string }) => Math.round(parseBRL(h.investidoFmt)) === Math.round(investidoValor));
}

describe('mercado secundário — retorno realizado da posição original após revenda', () => {
  it('credita ao vendedor original o ganho REAL da revenda (líquido − o que pagou), não o retorno esperado se tivesse segurado até o vencimento', async () => {
    const seller = await registerInvestidor();
    const buyer = await registerInvestidor();
    const { duplicataId, precoCompra } = await emitirEComprar('30.000', seller);
    const faceValor = 30000;

    // Revende por um preço bem acima do que pagou — lucro real diferente do "held to
    // maturity" (que seria valor de face 30.000 − precoCompra).
    const askingValor = Math.round(precoCompra * 1.03);
    const secundario = await request(app).get('/api/secundario').set('Authorization', `Bearer ${seller.token}`);
    const position = secundario.body.minhasPosicoes.find((p: { duplicataId: string }) => p.duplicataId === duplicataId);
    expect(position).toBeTruthy();
    const listRes = await request(app)
      .post('/api/secundario/listar')
      .set('Authorization', `Bearer ${seller.token}`)
      .send({ purchaseId: position.purchaseId, askingValor: String(askingValor) });
    const listing = listRes.body.market.find((l: { duplicataId: string }) => l.duplicataId === duplicataId);
    expect(listing).toBeTruthy();

    const buyResale = await request(app).post(`/api/secundario/${listing.id}/comprar`).set('Authorization', `Bearer ${buyer.token}`);
    expect(buyResale.status).toBe(200);

    const fee = platformFee(askingValor);
    const net = askingValor - fee;
    // Espelha exatamente o cálculo da produção (lib/resaleCore.ts's executeResaleTrade): o
    // custo de aquisição é recuperado como faceValor − retorno já arredondado da compra
    // original, não o precoCompra fracionário puro — um arredondamento de até R$1 é
    // esperado e correto, não um erro de precisão do teste.
    const custoRecuperado = faceValor - Math.round(faceValor - precoCompra);
    const retornoRealEsperado = Math.round(net - custoRecuperado);
    const retornoSeSeguradoAteVencimento = Math.round(30000 - precoCompra);
    // O preço de revenda foi escolhido acima do precoCompra original o suficiente pra que
    // os dois números sejam claramente diferentes — se o teste passasse com qualquer um dos
    // dois por coincidência de arredondamento, não provaria nada.
    expect(retornoRealEsperado).not.toBe(retornoSeSeguradoAteVencimento);

    const row = await historicoRowFor(seller.token, faceValor);
    expect(row).toBeTruthy();
    expect(row.retornoFmt).toBe(fmtBRLSigned(retornoRealEsperado));
  });

  it('registra um retorno negativo com o sinal certo quando a revenda dá prejuízo — nunca "+-R$"', async () => {
    const seller = await registerInvestidor();
    const buyer = await registerInvestidor();
    const { duplicataId, precoCompra } = await emitirEComprar('20.000', seller);
    const faceValor = 20000;

    // Revende abaixo do que pagou — prejuízo real, honesto (mesma disciplina de
    // lib/resaleCore.ts's comentário sobre retorno negativo já ser um caso real e esperado).
    const askingValor = Math.round(precoCompra * 0.9);
    const secundario = await request(app).get('/api/secundario').set('Authorization', `Bearer ${seller.token}`);
    const position = secundario.body.minhasPosicoes.find((p: { duplicataId: string }) => p.duplicataId === duplicataId);
    const listRes = await request(app)
      .post('/api/secundario/listar')
      .set('Authorization', `Bearer ${seller.token}`)
      .send({ purchaseId: position.purchaseId, askingValor: String(askingValor) });
    const listing = listRes.body.market.find((l: { duplicataId: string }) => l.duplicataId === duplicataId);

    const buyResale = await request(app).post(`/api/secundario/${listing.id}/comprar`).set('Authorization', `Bearer ${buyer.token}`);
    expect(buyResale.status).toBe(200);

    const fee = platformFee(askingValor);
    const custoRecuperado = faceValor - Math.round(faceValor - precoCompra);
    const retornoRealEsperado = Math.round(askingValor - fee - custoRecuperado);
    expect(retornoRealEsperado).toBeLessThan(0);

    const row = await historicoRowFor(seller.token, faceValor);
    expect(row).toBeTruthy();
    expect(row.retornoFmt).toBe(fmtBRLSigned(retornoRealEsperado));
    expect(row.retornoFmt).not.toContain('+-');
    expect(row.retornoFmt.startsWith('-')).toBe(true);
  });

  it('credita o mesmo jeito quando a posição sai por um lance aceito (accept bid), não só por compra direta', async () => {
    const seller = await registerInvestidor();
    const bidder = await registerInvestidor();
    const { duplicataId, precoCompra } = await emitirEComprar('25.000', seller);
    const faceValor = 25000;

    const secundario = await request(app).get('/api/secundario').set('Authorization', `Bearer ${seller.token}`);
    const position = secundario.body.minhasPosicoes.find((p: { duplicataId: string }) => p.duplicataId === duplicataId);
    const listRes = await request(app)
      .post('/api/secundario/listar')
      .set('Authorization', `Bearer ${seller.token}`)
      .send({ purchaseId: position.purchaseId, askingValor: String(Math.round(precoCompra * 1.1)) });
    const listing = listRes.body.market.find((l: { duplicataId: string }) => l.duplicataId === duplicataId);

    const bidValor = Math.round(precoCompra * 1.05);
    const bidRes = await request(app).post(`/api/secundario/${listing.id}/lances`).set('Authorization', `Bearer ${bidder.token}`).send({ valor: String(bidValor) });
    expect(bidRes.status).toBe(200);

    const sellerView = await request(app).get('/api/secundario').set('Authorization', `Bearer ${seller.token}`);
    const myListing = sellerView.body.meusAnuncios.find((a: { id: number }) => a.id === listing.id);
    const bidId = myListing.lances[0].id;

    const accept = await request(app).post(`/api/secundario/lances/${bidId}/aceitar`).set('Authorization', `Bearer ${seller.token}`);
    expect(accept.status).toBe(200);

    const fee = platformFee(bidValor);
    const custoRecuperado = faceValor - Math.round(faceValor - precoCompra);
    const retornoRealEsperado = Math.round(bidValor - fee - custoRecuperado);

    const row = await historicoRowFor(seller.token, faceValor);
    expect(row).toBeTruthy();
    expect(row.retornoFmt).toBe(fmtBRLSigned(retornoRealEsperado));
  });
});

describe('mercado secundário — retorno correto numa revenda encadeada (posição já revendida, revendida de novo)', () => {
  it('recupera o custo de aquisição certo mesmo quando a posição original já veio de uma revenda anterior', async () => {
    const original = await registerInvestidor();
    const middle = await registerInvestidor();
    const final = await registerInvestidor();
    const { duplicataId, precoCompra } = await emitirEComprar('40.000', original);
    const faceValor = 40000;

    // Primeira revenda: original -> middle
    const secundario1 = await request(app).get('/api/secundario').set('Authorization', `Bearer ${original.token}`);
    const position1 = secundario1.body.minhasPosicoes.find((p: { duplicataId: string }) => p.duplicataId === duplicataId);
    const primeiroPreco = Math.round(precoCompra * 1.02);
    const list1 = await request(app)
      .post('/api/secundario/listar')
      .set('Authorization', `Bearer ${original.token}`)
      .send({ purchaseId: position1.purchaseId, askingValor: String(primeiroPreco) });
    const listing1 = list1.body.market.find((l: { duplicataId: string }) => l.duplicataId === duplicataId);
    const buy1 = await request(app).post(`/api/secundario/${listing1.id}/comprar`).set('Authorization', `Bearer ${middle.token}`);
    expect(buy1.status).toBe(200);

    // Segunda revenda: middle -> final, por um preço diferente do primeiro
    const secundario2 = await request(app).get('/api/secundario').set('Authorization', `Bearer ${middle.token}`);
    const position2 = secundario2.body.minhasPosicoes.find((p: { duplicataId: string }) => p.duplicataId === duplicataId);
    expect(position2).toBeTruthy();
    const segundoPreco = Math.round(primeiroPreco * 1.015);
    const list2 = await request(app)
      .post('/api/secundario/listar')
      .set('Authorization', `Bearer ${middle.token}`)
      .send({ purchaseId: position2.purchaseId, askingValor: String(segundoPreco) });
    const listing2 = list2.body.market.find((l: { duplicataId: string }) => l.duplicataId === duplicataId);
    const buy2 = await request(app).post(`/api/secundario/${listing2.id}/comprar`).set('Authorization', `Bearer ${final.token}`);
    expect(buy2.status).toBe(200);

    // O investidor do meio pagou primeiroPreco (não o valor de face!) e recebeu
    // segundoPreco líquido de taxa — o retorno real dele precisa refletir isso, não um
    // número calculado como se ele tivesse pago o valor de face.
    const fee2 = platformFee(segundoPreco);
    const retornoMiddleEsperado = Math.round(segundoPreco - fee2 - primeiroPreco);
    // O "Investido" da linha do middle mostra primeiroPreco (o que ele realmente pagou),
    // não o valor de face — ao contrário da linha de uma compra primária. Achado à parte,
    // não corrigido nesta rodada (ver nota no PR): purchases.valor guarda coisas diferentes
    // dependendo da origem da compra (face pra compra primária, preço pago pra revenda).
    const row = await historicoRowFor(middle.token, primeiroPreco);
    expect(row).toBeTruthy();
    expect(row.retornoFmt).toBe(fmtBRLSigned(retornoMiddleEsperado));
  });
});
