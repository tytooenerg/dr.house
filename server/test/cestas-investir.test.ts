import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { approveKyb } from '../src/db/users.js';
import { platformFee } from '../src/lib/settlement.js';
import { computePurchasePrice } from '../src/lib/marketCompute.js';
import { getDuplicata } from '../src/db/duplicatas.js';
import { fmtBRLSigned } from '../src/lib/format.js';

// lib/cestasCore.ts's investInBasket reusa computePurchasePrice/settlePurchase/
// createPurchase exatamente como routes/market.ts faz — nenhum bug financeiro achado
// aqui (ver achado da varredura), mas zero desses caminhos tinha teste algum. Este
// arquivo fecha as lacunas mais importantes: ledger real, retorno determinístico, o
// cruzamento com o mercado secundário (nunca testado antes) e a aritmética de
// totalInvestido/restante.

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function parseBRL(s: string): number {
  return Number(s.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));
}

const ARROJADO_ANSWERS = {
  objetivo: 'maximizar',
  horizonte: 'longo',
  tolerancia_perda: 'aportaria',
  experiencia: 'regular',
  concentracao: 'baixa',
  renda: 'estavel',
};

// 'diversificada' (a única cesta que aceita qualquer rating AA/A/B/C — as outras duas
// filtram por rating e o score de uma duplicata recém-emitida com sacado desconhecido é
// imprevisível) exige um perfil de suitability nível >= 1 — um perfil 'arrojado' cobre
// todas as cestas.
async function registerInvestidorParaCestas() {
  const email = `inv-cestas-${unique()}@example.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Investidor', email, password: 'senha123', companyName: `Fundo Cestas ${unique()}`, role: 'investidor' });
  const token = res.body.token as string;
  const userId = res.body.user.id as number;
  approveKyb(userId);
  await request(app).post('/api/suitability/submit').set('Authorization', `Bearer ${token}`).send({ answers: ARROJADO_ANSWERS });
  return { token, userId };
}

async function registerCedente() {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Cedente', email: `ced-cestas-${unique()}@example.com`, password: 'senha123', companyName: `Cedente Cestas ${unique()} Ltda`, role: 'cedente' });
  return res.body.token as string;
}

// cestasCore.ts's investInBasket escolhe entre listMarketplace() — que só inclui uma
// duplicata depois de disparada pro leilão (status 'no_mercado'), diferente de
// POST /market/:id/buy (usado noutros testes desta sessão), que não exige isso.
async function emitirDuplicata(cedenteToken: string, sacadoCompany: string, valor: string) {
  let duplicataId = '';
  for (let attempt = 0; attempt < 8 && !duplicataId; attempt++) {
    const res = await request(app)
      .post('/api/emitir/submit')
      .set('Authorization', `Bearer ${cedenteToken}`)
      .send({ sacado: sacadoCompany, cnpj: '66.555.444/0001-33', valor, vencimento: '2026-12-31', seguro: false, nfAnexada: true, batchValores: [] });
    if (res.status === 200) duplicataId = res.body.duplicataId;
  }
  expect(duplicataId).toBeTruthy();
  const leilao = await request(app).post(`/api/minhas/${duplicataId}/leilao`).set('Authorization', `Bearer ${cedenteToken}`);
  expect(leilao.status).toBe(200);
  return duplicataId;
}

describe('POST /cestas/investir — ledger e retorno reais', () => {
  it('debita o investidor no precoCompra real e credita o cedente líquido da taxa — não no valor de face', async () => {
    const investor = await registerInvestidorParaCestas();
    const cedenteToken = await registerCedente();
    const sacadoCompany = `Sacado Cestas Ledger ${unique()} Ltda`;
    const duplicataId = await emitirDuplicata(cedenteToken, sacadoCompany, '35.000');
    const precoCompra = computePurchasePrice(getDuplicata(duplicataId)!).precoCompra;

    const invest = await request(app)
      .post('/api/cestas/investir')
      .set('Authorization', `Bearer ${investor.token}`)
      .send({ cesta: 'diversificada', valor: '999.999.999' });
    expect(invest.status).toBe(200);
    expect(invest.body.comprados.some((c: { duplicataId: string }) => c.duplicataId === duplicataId)).toBe(true);

    const extratoInvestor = await request(app).get('/api/account').set('Authorization', `Bearer ${investor.token}`);
    const debit = extratoInvestor.body.extrato.find((e: { descricao: string }) => e.descricao.includes(duplicataId));
    expect(debit).toBeTruthy();
    expect(debit.isPositive).toBe(false);
    expect(debit.valorFmt.replace(/\D/g, '')).toBe(String(Math.round(precoCompra)));

    const extratoCedente = await request(app).get('/api/account').set('Authorization', `Bearer ${cedenteToken}`);
    const credit = extratoCedente.body.extrato.find((e: { descricao: string }) => e.descricao.includes(duplicataId));
    expect(credit).toBeTruthy();
    expect(credit.isPositive).toBe(true);
    expect(credit.valorFmt.replace(/\D/g, '')).toBe(String(Math.round(precoCompra - platformFee(35000))));
  });

  it('registra em purchases.retorno o deságio real (valor de face − precoCompra), não um valor fabricado', async () => {
    const investor = await registerInvestidorParaCestas();
    const cedenteToken = await registerCedente();
    const sacadoCompany = `Sacado Cestas Retorno ${unique()} Ltda`;
    const duplicataId = await emitirDuplicata(cedenteToken, sacadoCompany, '22.000');
    const precoCompra = computePurchasePrice(getDuplicata(duplicataId)!).precoCompra;
    const retornoEsperado = Math.round(22000 - precoCompra);

    const invest = await request(app)
      .post('/api/cestas/investir')
      .set('Authorization', `Bearer ${investor.token}`)
      .send({ cesta: 'diversificada', valor: '999.999.999' });
    expect(invest.status).toBe(200);

    const historico = await request(app).get('/api/historico?pageSize=200').set('Authorization', `Bearer ${investor.token}`);
    const row = historico.body.historico.find((h: { empresa: string }) => h.empresa === sacadoCompany);
    expect(row).toBeTruthy();
    expect(row.retornoFmt).toBe(fmtBRLSigned(retornoEsperado));
  });

  it('uma posição comprada via cesta pode ser revendida no mercado secundário e o vendedor recebe o retorno realizado, não o valor de face', async () => {
    const seller = await registerInvestidorParaCestas();
    const buyer = await registerInvestidorParaCestas();
    const cedenteToken = await registerCedente();
    const sacadoCompany = `Sacado Cestas Revenda ${unique()} Ltda`;
    const duplicataId = await emitirDuplicata(cedenteToken, sacadoCompany, '28.000');
    const precoCompra = computePurchasePrice(getDuplicata(duplicataId)!).precoCompra;

    const invest = await request(app)
      .post('/api/cestas/investir')
      .set('Authorization', `Bearer ${seller.token}`)
      .send({ cesta: 'diversificada', valor: '999.999.999' });
    expect(invest.status).toBe(200);
    expect(invest.body.comprados.some((c: { duplicataId: string }) => c.duplicataId === duplicataId)).toBe(true);

    const secundario = await request(app).get('/api/secundario').set('Authorization', `Bearer ${seller.token}`);
    const position = secundario.body.minhasPosicoes.find((p: { duplicataId: string }) => p.duplicataId === duplicataId);
    expect(position).toBeTruthy(); // achado: se isso falhar, uma posição vinda de cesta não é revendável

    const askingValor = Math.round(precoCompra * 1.04);
    const listRes = await request(app)
      .post('/api/secundario/listar')
      .set('Authorization', `Bearer ${seller.token}`)
      .send({ purchaseId: position.purchaseId, askingValor: String(askingValor) });
    const listing = listRes.body.market.find((l: { duplicataId: string }) => l.duplicataId === duplicataId);
    expect(listing).toBeTruthy();

    const resaleBuy = await request(app).post(`/api/secundario/${listing.id}/comprar`).set('Authorization', `Bearer ${buyer.token}`);
    expect(resaleBuy.status).toBe(200);

    const fee = platformFee(askingValor);
    const net = askingValor - fee;
    // Mesmo padrão de resale-retorno.test.ts: o custo de aquisição é recuperado como
    // faceValor − retorno já arredondado da compra original (não o precoCompra fracionário
    // puro), então um arredondamento de até R$1 é esperado e correto.
    const custoRecuperado = 28000 - Math.round(28000 - precoCompra);
    const retornoRealEsperado = Math.round(net - custoRecuperado);

    const historico = await request(app).get('/api/historico?pageSize=200').set('Authorization', `Bearer ${seller.token}`);
    const row = historico.body.historico.find((h: { empresa: string }) => h.empresa === sacadoCompany);
    expect(row).toBeTruthy();
    expect(row.retornoFmt).toBe(fmtBRLSigned(retornoRealEsperado));
  });

  it('totalInvestidoFmt e restanteFmt batem com a soma real de precoCompra das ofertas compradas, não valor de face', async () => {
    const investor = await registerInvestidorParaCestas();
    const cedenteToken = await registerCedente();
    // Garante pelo menos um candidato próprio — os testes anteriores já podem ter drenado
    // todo o marketplace seedado com o mesmo orçamento gigante em 'diversificada'.
    await emitirDuplicata(cedenteToken, `Sacado Cestas Aritmetica ${unique()} Ltda`, '18.000');
    const budget = 999_999_999;

    const invest = await request(app)
      .post('/api/cestas/investir')
      .set('Authorization', `Bearer ${investor.token}`)
      .send({ cesta: 'diversificada', valor: String(budget) });
    expect(invest.status).toBe(200);
    expect(invest.body.comprados.length).toBeGreaterThan(0);

    const somaPrecoCompraReal = invest.body.comprados.reduce((sum: number, c: { duplicataId: string }) => {
      const d = getDuplicata(c.duplicataId)!;
      return sum + computePurchasePrice(d).precoCompra;
    }, 0);

    const totalInvestido = parseBRL(invest.body.totalInvestidoFmt);
    const restante = parseBRL(invest.body.restanteFmt);
    expect(Math.round(totalInvestido)).toBe(Math.round(somaPrecoCompraReal));
    expect(Math.round(budget - restante)).toBe(Math.round(totalInvestido));
  });
});
