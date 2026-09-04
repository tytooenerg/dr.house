import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { approveKyb, updateKybForm, setInstitutionalReportingEnabled } from '../src/db/users.js';
import { computePurchasePrice } from '../src/lib/marketCompute.js';
import { getDuplicata } from '../src/db/duplicatas.js';
import { platformFee } from '../src/lib/settlement.js';

// Achado corrigido: "Investido"/totalInvestido em routes/historico.ts,
// lib/institutionalReporting.ts, lib/portfolioRebalance.ts e lib/investorPerformance.ts
// somavam purchases.valor direto — valor de face numa compra primária, não o preço
// realmente pago (sempre <= valor de face por causa do deságio). Isso superestimava
// "quanto o investidor investiu" e subestimava toda métrica de retorno percentual
// (rentMedia, retornoAnualizadoPct) derivada dele. Corrigido via faceValor - retorno
// (fórmula universal, só válida enquanto a posição está ativa — ver comentário em cada
// arquivo). db/resaleListings.ts's discountRatio também usava purchases.valor em vez do
// valor de face real de duplicatas.

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function parseBRL(s: string): number {
  return Number(s.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));
}

async function registerInvestidor() {
  const email = `inv-precopago-${unique()}@example.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Investidor', email, password: 'senha123', companyName: `Fundo ${unique()}`, role: 'investidor' });
  approveKyb(res.body.user.id);
  return { token: res.body.token as string, userId: res.body.user.id as number };
}

async function emitirELeiloar(valor: string) {
  const cedenteRes = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Cedente', email: `ced-precopago-${unique()}@example.com`, password: 'senha123', companyName: `Cedente ${unique()} Ltda`, role: 'cedente' });
  const cedenteToken = cedenteRes.body.token as string;
  let duplicataId = '';
  for (let attempt = 0; attempt < 8 && !duplicataId; attempt++) {
    const res = await request(app)
      .post('/api/emitir/submit')
      .set('Authorization', `Bearer ${cedenteToken}`)
      .send({ sacado: `Sacado Preco Pago ${unique()} Ltda`, cnpj: '77.666.555/0001-44', valor, vencimento: '2026-12-31', seguro: false, nfAnexada: true, batchValores: [] });
    if (res.status === 200) duplicataId = res.body.duplicataId;
  }
  expect(duplicataId).toBeTruthy();
  return duplicataId;
}

describe('purchases.valor ambíguo — preço pago real em vez de valor de face', () => {
  it('GET /historico/institutional/analytics soma o preço realmente pago, não o valor de face', async () => {
    const investor = await registerInvestidor();
    setInstitutionalReportingEnabled(investor.userId, true);
    const duplicataId = await emitirELeiloar('50.000');
    const precoCompra = computePurchasePrice(getDuplicata(duplicataId)!).precoCompra;

    const buy = await request(app).post(`/api/market/${duplicataId}/buy`).set('Authorization', `Bearer ${investor.token}`);
    expect(buy.status).toBe(200);

    const analytics = await request(app).get('/api/historico/institutional/analytics').set('Authorization', `Bearer ${investor.token}`);
    expect(analytics.status).toBe(200);
    const totalInvestido = parseBRL(analytics.body.totalInvestidoFmt);
    // Mesma cadeia de arredondamento da produção: faceValor - Math.round(faceValor -
    // precoCompra), não Math.round(precoCompra) direto — Math.round(x) e
    // N - Math.round(N - x) só divergem no caso extremo de x cair exatamente em ",50",
    // mas usar a fórmula exata elimina esse risco em vez de confiar em não bater nele.
    const investidoEsperado = 50000 - Math.round(50000 - precoCompra);
    expect(Math.round(totalInvestido)).toBe(investidoEsperado);
    expect(Math.round(totalInvestido)).not.toBe(50000);
  });

  it('GET /historico/rebalanceamento soma o preço realmente pago na alocação por rating/sacado', async () => {
    const investor = await registerInvestidor();
    const duplicataId = await emitirELeiloar('40.000');
    const precoCompra = computePurchasePrice(getDuplicata(duplicataId)!).precoCompra;

    const buy = await request(app).post(`/api/market/${duplicataId}/buy`).set('Authorization', `Bearer ${investor.token}`);
    expect(buy.status).toBe(200);

    const rebalance = await request(app).get('/api/historico/rebalanceamento').set('Authorization', `Bearer ${investor.token}`);
    expect(rebalance.status).toBe(200);
    const totalInvestido = parseBRL(rebalance.body.totalInvestidoFmt);
    // Mesma cadeia de arredondamento da produção — ver comentário do teste anterior.
    const investidoEsperado = 40000 - Math.round(40000 - precoCompra);
    expect(Math.round(totalInvestido)).toBe(investidoEsperado);
    expect(Math.round(totalInvestido)).not.toBe(40000);
  });

  it('GET /historico/performance calcula retornoAnualizadoPct sobre o preço pago, não o valor de face', async () => {
    const investor = await registerInvestidor();
    const duplicataId = await emitirELeiloar('60.000');
    const precoCompra = computePurchasePrice(getDuplicata(duplicataId)!).precoCompra;
    const retornoReal = Math.round(60000 - precoCompra);
    // Mesma cadeia de arredondamento da produção: faceValor - retorno (já arredondado),
    // não Math.round(precoCompra) direto — um arredondamento de até R$1 é esperado.
    const investidoEsperado = 60000 - retornoReal;

    const buy = await request(app).post(`/api/market/${duplicataId}/buy`).set('Authorization', `Bearer ${investor.token}`);
    expect(buy.status).toBe(200);

    const perf = await request(app).get('/api/historico/performance').set('Authorization', `Bearer ${investor.token}`);
    expect(perf.status).toBe(200);
    expect(perf.body.totalInvestido).toBe(investidoEsperado);

    // retornoPct real = retorno / precoCompra, estritamente maior que a versão ingênua
    // retorno / valorDeFace (o bug antigo) — precoCompra é sempre menor que o valor de face.
    const retornoPctIngenuo = (retornoReal / 60000) * 100;
    const posicao = perf.body.positions[0];
    expect(posicao.retornoAnualizadoPct).toBeGreaterThan(retornoPctIngenuo * (365 / posicao.diasCarencia) * 0.999);
  });

  it('uma posição já revendida mantém "Investido" como o registro original (valor de face) — não recalcula por cima de um retorno já sobrescrito pela revenda', async () => {
    const seller = await registerInvestidor();
    const buyer = await registerInvestidor();
    const duplicataId = await emitirELeiloar('30.000');
    const precoCompra = computePurchasePrice(getDuplicata(duplicataId)!).precoCompra;

    await request(app).post(`/api/market/${duplicataId}/buy`).set('Authorization', `Bearer ${seller.token}`);

    const secundario = await request(app).get('/api/secundario').set('Authorization', `Bearer ${seller.token}`);
    const position = secundario.body.minhasPosicoes.find((p: { duplicataId: string }) => p.duplicataId === duplicataId);
    const askingValor = Math.round(precoCompra * 1.05);
    const listRes = await request(app)
      .post('/api/secundario/listar')
      .set('Authorization', `Bearer ${seller.token}`)
      .send({ purchaseId: position.purchaseId, askingValor: String(askingValor) });
    const listing = listRes.body.market.find((l: { duplicataId: string }) => l.duplicataId === duplicataId);
    const resaleBuy = await request(app).post(`/api/secundario/${listing.id}/comprar`).set('Authorization', `Bearer ${buyer.token}`);
    expect(resaleBuy.status).toBe(200);

    // A posição original do vendedor agora está inativa (active=0) e seu retorno foi
    // sobrescrito com o ganho realizado da revenda (lib/resaleCore.ts) — não é mais
    // "faceValor - precoCompra". Aplicar faceValor - retorno por cima disso daria um
    // número sem sentido; por isso "Investido" dessa linha continua vindo direto de
    // purchases.valor (nunca tocado por deactivatePurchase) — que numa compra primária é
    // o valor de face (30000), o mesmo registro que resale-retorno.test.ts já espera.
    const historico = await request(app).get('/api/historico?pageSize=200').set('Authorization', `Bearer ${seller.token}`);
    const row = historico.body.historico.find((h: { investidoFmt: string }) => Math.round(parseBRL(h.investidoFmt)) === 30000);
    expect(row).toBeTruthy();
    expect(Math.round(parseBRL(row.investidoFmt))).not.toBe(Math.round(precoCompra));
  });

  it('discountRatio do block trade usa o valor de face real, não purchases.valor, mesmo quando o anúncio vem de uma revenda anterior', async () => {
    const originalBuyer = await registerInvestidor();
    const reseller = await registerInvestidor();
    const institutionalBuyer = await registerInvestidor();
    updateKybForm(institutionalBuyer.userId, 'pl', '15.000.000');

    // Face 500.000 — o vendedor original compra, revende por bem menos que o valor de
    // face (deságio grande de propósito), e ESSA posição revendida é o que entra no
    // anúncio institucional. purchases.valor da posição do "reseller" é o preço pago na
    // revenda (bem menor que 500.000) — se discountRatio usasse essa coluna, a ordenação
    // ficaria errada.
    const duplicataId = await emitirELeiloar('500.000');
    await request(app).post(`/api/market/${duplicataId}/buy`).set('Authorization', `Bearer ${originalBuyer.token}`);
    const secundario1 = await request(app).get('/api/secundario').set('Authorization', `Bearer ${originalBuyer.token}`);
    const pos1 = secundario1.body.minhasPosicoes.find((p: { duplicataId: string }) => p.duplicataId === duplicataId);
    const list1 = await request(app)
      .post('/api/secundario/listar')
      .set('Authorization', `Bearer ${originalBuyer.token}`)
      .send({ purchaseId: pos1.purchaseId, askingValor: '350.000' });
    const listing1 = list1.body.market.find((l: { duplicataId: string }) => l.duplicataId === duplicataId);
    await request(app).post(`/api/secundario/${listing1.id}/comprar`).set('Authorization', `Bearer ${reseller.token}`);

    const secundario2 = await request(app).get('/api/secundario').set('Authorization', `Bearer ${reseller.token}`);
    const pos2 = secundario2.body.minhasPosicoes.find((p: { duplicataId: string }) => p.duplicataId === duplicataId);
    // Anuncia de novo por 320.000 — desconto de só 8,6% vs. purchases.valor (350.000),
    // mas de 36% vs. o valor de face real (500.000). Se discountRatio comparasse contra
    // purchases.valor, este anúncio pareceria uma oportunidade ruim; contra o valor de
    // face real, é uma das melhores do lote.
    const list2 = await request(app)
      .post('/api/secundario/listar')
      .set('Authorization', `Bearer ${reseller.token}`)
      .send({ purchaseId: pos2.purchaseId, askingValor: '320.000' });
    const listing2 = list2.body.market.find((l: { duplicataId: string }) => l.duplicataId === duplicataId);
    expect(listing2).toBeTruthy();

    // Segundo anúncio concorrente com desconto real menor (só pra garantir que o sweep
    // tenha mais de um candidato disputando ordem, e orçamento suficiente pros dois).
    const duplicataId2 = await emitirELeiloar('300.000');
    await request(app).post(`/api/market/${duplicataId2}/buy`).set('Authorization', `Bearer ${originalBuyer.token}`);
    const secundario3 = await request(app).get('/api/secundario').set('Authorization', `Bearer ${originalBuyer.token}`);
    const pos3 = secundario3.body.minhasPosicoes.find((p: { duplicataId: string }) => p.duplicataId === duplicataId2);
    const list3 = await request(app)
      .post('/api/secundario/listar')
      .set('Authorization', `Bearer ${originalBuyer.token}`)
      .send({ purchaseId: pos3.purchaseId, askingValor: '290.000' }); // só 3,3% de desconto vs. valor de face
    expect(list3.body.market.find((l: { duplicataId: string }) => l.duplicataId === duplicataId2)).toBeTruthy();

    const trade = await request(app)
      .post('/api/secundario/block-trade')
      .set('Authorization', `Bearer ${institutionalBuyer.token}`)
      .send({ valorMaximo: '1.000.000', quantidadeMax: 1 }); // só cabe 1 — prova a ordem real
    expect(trade.status).toBe(200);
    expect(trade.body.quantidade).toBe(1);
    // O anúncio com maior desconto real vs. valor de face (o de duplicataId, 36%) tem que
    // ser escolhido primeiro — não o de duplicataId2 (só 3,3%), e não seria escolhido se
    // discountRatio comparasse contra purchases.valor (que daria só 8,6% pro primeiro).
    expect(trade.body.itens[0].duplicataId).toBe(duplicataId);
  });
});
