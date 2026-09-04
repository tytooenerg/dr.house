import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { approveKyb, updateKybForm } from '../src/db/users.js';
import { getAceiteByDuplicata, setAceiteStatus } from '../src/db/aceites.js';
import { platformFee } from '../src/lib/settlement.js';

// lib/revenue.ts's getRealPlatformFees usava recomputar platformFee(purchases.valor) do
// zero pra cada linha de `purchases` — o que não tinha como saber que a taxa de uma
// revenda originada de um block trade institucional (lib/blockTrade.ts) já tinha sido
// descontada em até 30%, superestimando totalColetadoFmt/mediaEfetivaPct toda vez que um
// block trade acontecia. Agora conta a partir de platform_fee_events, um log real gravado
// no momento exato em que settlePurchase/settleResale cobram a taxa de verdade — mesmo
// padrão que insurance_settlements/legal_collection_fees já usavam nas duas funções vizinhas.

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function parseBRL(s: string): number {
  return Number(s.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));
}

async function adminToken() {
  const res = await request(app).post('/api/auth/login').send({ email: 'admin@lastro.demo', password: 'demo1234' });
  return res.body.token as string;
}

async function registerInvestidor() {
  const email = `inv-revenue-${unique()}@example.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Investidor', email, password: 'senha123', companyName: `Fundo ${unique()}`, role: 'investidor' });
  approveKyb(res.body.user.id);
  return { token: res.body.token as string, userId: res.body.user.id as number };
}

async function registerInstitutionalBuyer() {
  const buyer = await registerInvestidor();
  updateKybForm(buyer.userId, 'pl', '15.000.000');
  return buyer;
}

async function getRevenue(token: string) {
  const res = await request(app).get('/api/revenue').set('Authorization', `Bearer ${token}`);
  return res.body.realFees as { totalColetadoFmt: string; totalLiquidacoes: number; mediaEfetivaPct: number | null };
}

async function emitirELeiloar(cedenteToken: string, valor: string) {
  let duplicataId = '';
  for (let attempt = 0; attempt < 8 && !duplicataId; attempt++) {
    const res = await request(app)
      .post('/api/emitir/submit')
      .set('Authorization', `Bearer ${cedenteToken}`)
      .send({ sacado: `Sacado Revenue ${unique()} Ltda`, cnpj: '44.333.222/0001-11', valor, vencimento: '2026-12-31', seguro: false, nfAnexada: true, batchValores: [] });
    if (res.status === 200) duplicataId = res.body.duplicataId;
  }
  expect(duplicataId).toBeTruthy();
  setAceiteStatus(getAceiteByDuplicata(duplicataId)!.id, 'aceita');
  return duplicataId;
}

describe('GET /revenue — taxa de plataforma real (platform_fee_events)', () => {
  it('conta exatamente o fee real de uma compra primária, sem sobrepor com desconto nenhum', async () => {
    const cedenteRes = await request(app)
      .post('/api/auth/register')
      .send({ nome: 'Cedente', email: `ced-revenue-${unique()}@example.com`, password: 'senha123', companyName: `Cedente Revenue ${unique()} Ltda`, role: 'cedente' });
    const cedenteToken = cedenteRes.body.token as string;
    const investor = await registerInvestidor();

    const before = await getRevenue(investor.token);
    const beforeFees = parseBRL(before.totalColetadoFmt);
    const beforeCount = before.totalLiquidacoes;

    const duplicataId = await emitirELeiloar(cedenteToken, '50.000');
    const buy = await request(app).post(`/api/market/${duplicataId}/buy`).set('Authorization', `Bearer ${investor.token}`);
    expect(buy.status).toBe(200);

    const after = await getRevenue(investor.token);
    const deltaFees = parseBRL(after.totalColetadoFmt) - beforeFees;
    expect(after.totalLiquidacoes).toBe(beforeCount + 1);
    expect(Math.round(deltaFees)).toBe(Math.round(platformFee(50000)));
  });

  it('conta o fee real de uma revenda comum (sem desconto) — um segundo evento distinto, não substitui o da compra original', async () => {
    const cedenteRes = await request(app)
      .post('/api/auth/register')
      .send({ nome: 'Cedente', email: `ced-revenue2-${unique()}@example.com`, password: 'senha123', companyName: `Cedente Revenue2 ${unique()} Ltda`, role: 'cedente' });
    const cedenteToken = cedenteRes.body.token as string;
    const seller = await registerInvestidor();
    const buyer = await registerInvestidor();

    const duplicataId = await emitirELeiloar(cedenteToken, '40.000');
    const buy = await request(app).post(`/api/market/${duplicataId}/buy`).set('Authorization', `Bearer ${seller.token}`);
    expect(buy.status).toBe(200);

    const beforeResale = await getRevenue(seller.token);
    const beforeFees = parseBRL(beforeResale.totalColetadoFmt);
    const beforeCount = beforeResale.totalLiquidacoes;

    const secundario = await request(app).get('/api/secundario').set('Authorization', `Bearer ${seller.token}`);
    const position = secundario.body.minhasPosicoes.find((p: { duplicataId: string }) => p.duplicataId === duplicataId);
    const askingValor = 41000;
    const listRes = await request(app)
      .post('/api/secundario/listar')
      .set('Authorization', `Bearer ${seller.token}`)
      .send({ purchaseId: position.purchaseId, askingValor: String(askingValor) });
    const listing = listRes.body.market.find((l: { duplicataId: string }) => l.duplicataId === duplicataId);
    const resale = await request(app).post(`/api/secundario/${listing.id}/comprar`).set('Authorization', `Bearer ${buyer.token}`);
    expect(resale.status).toBe(200);

    const after = await getRevenue(seller.token);
    const deltaFees = parseBRL(after.totalColetadoFmt) - beforeFees;
    // Duas taxas reais e distintas foram cobradas até aqui (compra + revenda) — a revenda
    // soma em cima da compra, nunca a recalcula/substitui.
    expect(after.totalLiquidacoes).toBe(beforeCount + 1);
    expect(Math.round(deltaFees)).toBe(Math.round(platformFee(askingValor)));
  });

  it('conta o fee líquido do desconto institucional real de um block trade — não a taxa cheia', async () => {
    const admin = await adminToken();
    const buyer = await registerInstitutionalBuyer();

    async function sellerWithListing(askingValor: string) {
      const seller = await registerInvestidor();
      const market = await request(app).get('/api/market').set('Authorization', `Bearer ${seller.token}`);
      const parseDataBr = (v: string) => { const [d, m, y] = v.split('/'); return new Date(`${y}-${m}-${d}`); };
      const buyable = market.body.offers.find((o: { canBuy: boolean; vencimento: string }) => o.canBuy && parseDataBr(o.vencimento).getTime() > Date.now());
      await request(app).post(`/api/market/${buyable.id}/buy`).set('Authorization', `Bearer ${seller.token}`);
      const secundario = await request(app).get('/api/secundario').set('Authorization', `Bearer ${seller.token}`);
      const position = secundario.body.minhasPosicoes.find((p: { duplicataId: string }) => p.duplicataId === buyable.id);
      const listRes = await request(app)
        .post('/api/secundario/listar')
        .set('Authorization', `Bearer ${seller.token}`)
        .send({ purchaseId: position.purchaseId, askingValor });
      const listing = listRes.body.market.find((l: { duplicataId: string }) => l.duplicataId === buyable.id);
      return listing.id as number;
    }

    // 180k + 150k = 330k — acima do mínimo de block trade (300k) e na faixa de desconto de
    // 10% (abaixo de 1 milhão) — mesmos valores já usados no happy-path de block-trade.test.ts.
    await sellerWithListing('180.000');
    await sellerWithListing('150.000');

    const before = await getRevenue(admin);
    const beforeFees = parseBRL(before.totalColetadoFmt);
    const beforeCount = before.totalLiquidacoes;

    const trade = await request(app).post('/api/secundario/block-trade').set('Authorization', `Bearer ${buyer.token}`).send({ valorMaximo: '2.000.000' });
    expect(trade.status).toBe(200);
    expect(trade.body.quantidade).toBe(2);
    expect(trade.body.descontoPct).toBe(10);

    const after = await getRevenue(admin);
    const deltaFees = parseBRL(after.totalColetadoFmt) - beforeFees;
    const feeCheio = platformFee(180000) + platformFee(150000);
    const feeComDesconto = feeCheio * 0.9;
    // O achado que esse teste prova: contar a taxa cheia aqui (sem aplicar o desconto real
    // de 10%) seria o bug antigo — a soma real tem que bater com o valor líquido do
    // desconto, não com feeCheio.
    expect(Math.round(deltaFees)).not.toBe(Math.round(feeCheio));
    expect(Math.round(deltaFees)).toBe(Math.round(feeComDesconto));
    expect(after.totalLiquidacoes).toBe(beforeCount + 2);
  });
});
