import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { getFundoBalance, getFundoInvestorQuotas, getFundoTotalQuotas } from '../src/db/confirmingFundo.js';
import { fundoFinanciarCompra, fundoRetornoDePagamento, getFundoCotaPrice } from '../src/lib/confirmingFundo.js';
import { listAuditLog } from '../src/db/audit.js';
import { createDuplicata } from '../src/db/duplicatas.js';

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function registerInvestidor() {
  const email = `inv-conf-fundo-${unique()}@example.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Investidor Confirming', email, password: 'senha123', companyName: `Fomento Confirming ${unique()}`, role: 'investidor' });
  return { token: res.body.token as string, userId: res.body.user.id as number };
}

async function registerCedente() {
  const email = `ced-conf-fundo-${unique()}@example.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Cedente Confirming', email, password: 'senha123', companyName: `Cedente Confirming ${unique()}`, role: 'cedente' });
  return { token: res.body.token as string };
}

// fundoFinanciarCompra/fundoRetornoDePagamento gravam a duplicata financiada no ledger
// (duplicata_id REFERENCES duplicatas(id)) — precisa de uma duplicata real, não um id
// inventado, pra não violar a foreign key.
function criarDuplicataDeTeste(valor: number): string {
  return createDuplicata({
    cedenteId: null,
    cedenteNome: 'Cedente Genérico Confirming',
    sacadoNome: 'Sacado Genérico Confirming',
    sacadoCnpj: '',
    valor,
    vencimento: '2026-12-31',
    emissao: '10/08/2026',
    status: 'vendida',
    lastroPct: 100,
    seguro: false,
  }).id;
}

describe('Fundo de Fomento do Confirming — aporte e saldo do pool', () => {
  it('a contribution increases the real pool balance and debits the investor own ledger', async () => {
    const { token } = await registerInvestidor();
    const before = getFundoBalance();
    const res = await request(app).post('/api/confirming-fundo/contribuir').set('Authorization', `Bearer ${token}`).send({ valor: 40000 });
    expect(res.status).toBe(200);
    expect(getFundoBalance() - before).toBeCloseTo(40000, 6);

    const extrato = await request(app).get('/api/account').set('Authorization', `Bearer ${token}`);
    const entry = extrato.body.extrato.find((e: { descricao: string }) => e.descricao.includes('Aporte no fundo de fomento do Programa Confirming'));
    expect(entry).toBeTruthy();
    expect(entry.isPositive).toBe(false);

    const auditEntry = listAuditLog(20).find((e) => e.action === 'confirming_fundo.aporte');
    expect(auditEntry).toBeDefined();
  });

  it('rejects a contribution from a non-investidor (cedente)', async () => {
    const { token } = await registerCedente();
    const res = await request(app).post('/api/confirming-fundo/contribuir').set('Authorization', `Bearer ${token}`).send({ valor: 1000 });
    expect(res.status).toBe(403);
  });

  it('exposes the real balance and the caller-specific position via GET /confirming-fundo', async () => {
    const { token } = await registerInvestidor();
    await request(app).post('/api/confirming-fundo/contribuir').set('Authorization', `Bearer ${token}`).send({ valor: 25000 });

    const res = await request(app).get('/api/confirming-fundo').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.yourPositionFmt).toBeTruthy();
    expect(res.body.yourAvailableToRedeemFmt).toBeTruthy();
    expect(res.body.cotaPriceFmt).toMatch(/^R\$ \d/);
  });

  it('a non-investidor gets the fund-wide view with no personal position fields', async () => {
    const { token } = await registerCedente();
    const res = await request(app).get('/api/confirming-fundo').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.yourPositionFmt).toBeNull();
  });
});

describe('Fundo de Fomento do Confirming — resgate', () => {
  it('redeems up to the available amount and rejects redeeming more than the real position/pool balance allows', async () => {
    const { token } = await registerInvestidor();
    await request(app).post('/api/confirming-fundo/contribuir').set('Authorization', `Bearer ${token}`).send({ valor: 30000 });

    const tooMuch = await request(app).post('/api/confirming-fundo/resgatar').set('Authorization', `Bearer ${token}`).send({ valor: 999999999 });
    expect(tooMuch.status).toBe(409);
    expect(tooMuch.body.error).toBe('insufficient_available');

    const balanceBefore = getFundoBalance();
    const ok = await request(app).post('/api/confirming-fundo/resgatar').set('Authorization', `Bearer ${token}`).send({ valor: 10000 });
    expect(ok.status).toBe(200);
    expect(getFundoBalance()).toBeCloseTo(balanceBefore - 10000, 6);

    const auditEntry = listAuditLog(20).find((e) => e.action === 'confirming_fundo.resgate');
    expect(auditEntry).toBeDefined();
  });

  it('rejects a redemption of a non-positive amount', async () => {
    const { token } = await registerInvestidor();
    const res = await request(app).post('/api/confirming-fundo/resgatar').set('Authorization', `Bearer ${token}`).send({ valor: -5 });
    expect(res.status).toBe(400);
  });
});

// fundoFinanciarCompra/fundoRetornoDePagamento não têm rota própria ainda — só ganham um
// chamador real (o financiamento automático do Programa Confirming) numa PR seguinte.
// Testados diretamente na lib pra confirmar que o mecanismo de cota/NAV já funciona de
// ponta a ponta antes dessa PR existir, mesmo raciocínio de
// credit-line-fund-quotas.test.ts pro fundo da linha de crédito.
describe('Fundo de Fomento do Confirming — cota/NAV distribui rendimento proporcionalmente', () => {
  it('an early contributor earns real yield once a financed purchase returns more than it cost', async () => {
    const investorA = await registerInvestidor();
    const aporteA = 100000;
    await request(app).post('/api/confirming-fundo/contribuir').set('Authorization', `Bearer ${investorA.token}`).send({ valor: aporteA });
    const quotasA = getFundoInvestorQuotas(investorA.userId);
    expect(quotasA).toBeGreaterThan(0);

    // Simula o que a PR de financiamento automático vai fazer: o fundo compra uma duplicata
    // (dinheiro sai) e, mais tarde, recebe de volta o valor de face na quitação (dinheiro
    // volta acima do que saiu — o deságio embutido é o rendimento real do fundo).
    const duplicataId = criarDuplicataDeTeste(51500);
    fundoFinanciarCompra(duplicataId, 50000);
    fundoRetornoDePagamento(duplicataId, 51500);

    const cotaPriceDepois = getFundoCotaPrice();
    const equityA = quotasA * cotaPriceDepois;
    expect(equityA).toBeGreaterThan(aporteA);

    // Um segundo investidor aportando os mesmos reais agora, com o preço já mais alto,
    // compra menos cotas por isso — sem ganho retroativo sobre rendimento que já aconteceu.
    const investorB = await registerInvestidor();
    await request(app).post('/api/confirming-fundo/contribuir').set('Authorization', `Bearer ${investorB.token}`).send({ valor: aporteA });
    const quotasB = getFundoInvestorQuotas(investorB.userId);
    expect(quotasB).toBeLessThan(quotasA);
  });

  it('never mints quotas for a returned amount — total quotas only change on aporte/resgate', () => {
    const totalBefore = getFundoTotalQuotas();
    const duplicataId = criarDuplicataDeTeste(10500);
    fundoFinanciarCompra(duplicataId, 10000);
    fundoRetornoDePagamento(duplicataId, 10500);
    expect(getFundoTotalQuotas()).toBe(totalBefore);
  });
});
