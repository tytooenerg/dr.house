import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { db } from '../src/db/index.js';
import { getAceiteByDuplicata, setAceiteStatus } from '../src/db/aceites.js';
import { getFundoBalance } from '../src/db/confirmingFundo.js';
import { getProgramaBySacado } from '../src/db/confirming.js';
import { runFundoAutoBuyTick } from '../src/lib/confirmingFundoAutoBuy.js';

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function adminToken() {
  const res = await request(app).post('/api/auth/login').send({ email: 'admin@lastro.demo', password: 'demo1234' });
  return res.body.token as string;
}

async function investorToken() {
  const res = await request(app).post('/api/auth/login').send({ email: 'investidor@lastro.demo', password: 'demo1234' });
  return res.body.token as string;
}

async function registerCedente(companyName: string) {
  const res = await request(app).post('/api/auth/register').send({
    nome: 'Cedente Teste',
    email: `ced-fee-${unique()}@example.com`,
    password: 'senha123',
    companyName,
    role: 'cedente',
  });
  return res.body.token as string;
}

async function submitEmitir(token: string, overrides: Partial<{ vencimento: string; sacado: string; cnpj: string; valor: string }> = {}) {
  let lastStatus = 0;
  let body: Record<string, unknown> = {};
  for (let attempt = 0; attempt < 10; attempt++) {
    const res = await request(app)
      .post('/api/emitir/submit')
      .set('Authorization', `Bearer ${token}`)
      .send({
        sacado: overrides.sacado ?? 'Grupo Atlas Varejo',
        cnpj: overrides.cnpj ?? '12.345.678/0001-90',
        valor: overrides.valor ?? '10.000',
        vencimento: overrides.vencimento ?? '2020-01-10',
        seguro: false,
        nfAnexada: true,
        batchValores: [],
      });
    lastStatus = res.status;
    body = res.body;
    if (res.status === 200) break;
    expect(res.status).toBe(502);
  }
  expect(lastStatus).toBe(200);
  return body as { duplicataId: string };
}

describe('Fee de sucesso — cobrança jurídica', () => {
  it('requires admin role and validates the configured percentage', async () => {
    const cedente = await registerCedente(`Sem Acesso Fee ${unique()} Ltda`);
    const denied = await request(app).get('/api/admin/juridico/cobranca-fee').set('Authorization', `Bearer ${cedente}`);
    expect(denied.status).toBe(403);

    const admin = await adminToken();
    const get = await request(app).get('/api/admin/juridico/cobranca-fee').set('Authorization', `Bearer ${admin}`);
    expect(get.status).toBe(200);
    expect(get.body.feePct).toBe(5);

    const tooHigh = await request(app).put('/api/admin/juridico/cobranca-fee').set('Authorization', `Bearer ${admin}`).send({ feePct: 80 });
    expect(tooHigh.status).toBe(400);

    const ok = await request(app).put('/api/admin/juridico/cobranca-fee').set('Authorization', `Bearer ${admin}`).send({ feePct: 7.5 });
    expect(ok.status).toBe(200);
    const getAfter = await request(app).get('/api/admin/juridico/cobranca-fee').set('Authorization', `Bearer ${admin}`);
    expect(getAfter.body.feePct).toBe(7.5);
  });

  it('charges the cedente when the duplicata was never sold, marks it paga, and refuses a second charge', async () => {
    const admin = await adminToken();
    const cedente = await registerCedente(`Fornecedora Recuperacao ${unique()} Ltda`);
    const emitted = await submitEmitir(cedente, { vencimento: '2020-02-15' });

    const blocked = await request(app).post(`/api/admin/juridico/cobranca/${emitted.duplicataId}/recuperar`).set('Authorization', `Bearer ${admin}`);
    expect(blocked.status).toBe(409);

    const aceite = getAceiteByDuplicata(emitted.duplicataId)!;
    setAceiteStatus(aceite.id, 'aceita');

    const recover = await request(app).post(`/api/admin/juridico/cobranca/${emitted.duplicataId}/recuperar`).set('Authorization', `Bearer ${admin}`);
    expect(recover.status).toBe(200);
    expect(recover.body.chargedRole).toBe('cedente');
    expect(recover.body.feeValor).toBeCloseTo(10_000 * (recover.body.feePct / 100), 2);

    // Recovered duplicata drops out of the overdue queue (status now 'paga').
    const list = await request(app).get('/api/admin/juridico/cobranca').set('Authorization', `Bearer ${admin}`);
    expect((list.body.overdue as { duplicataId: string }[]).some((o) => o.duplicataId === emitted.duplicataId)).toBe(false);

    const again = await request(app).post(`/api/admin/juridico/cobranca/${emitted.duplicataId}/recuperar`).set('Authorization', `Bearer ${admin}`);
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('already_recovered');

    const history = await request(app).get('/api/admin/juridico/recuperacoes').set('Authorization', `Bearer ${admin}`);
    expect((history.body.recuperacoes as { duplicataId: string }[]).some((r) => r.duplicataId === emitted.duplicataId)).toBe(true);
  });

  it('charges the investidor instead of the cedente once the duplicata was sold', async () => {
    const admin = await adminToken();
    const investor = await investorToken();
    const cedente = await registerCedente(`Fornecedora Vendida ${unique()} Ltda`);
    const emitted = await submitEmitir(cedente, { vencimento: '2020-03-20', sacado: 'Metalúrgica Serrana S.A.', cnpj: '23.456.789/0001-01' });

    const aceite = getAceiteByDuplicata(emitted.duplicataId)!;
    setAceiteStatus(aceite.id, 'aceita');

    const leilao = await request(app).post(`/api/minhas/${emitted.duplicataId}/leilao`).set('Authorization', `Bearer ${cedente}`);
    expect(leilao.status).toBe(200);

    const buy = await request(app).post(`/api/market/${emitted.duplicataId}/buy`).set('Authorization', `Bearer ${investor}`);
    expect(buy.status).toBe(200);

    const recover = await request(app).post(`/api/admin/juridico/cobranca/${emitted.duplicataId}/recuperar`).set('Authorization', `Bearer ${admin}`);
    expect(recover.status).toBe(200);
    expect(recover.body.chargedRole).toBe('investidor');
  });

  it('credita o credor pelo valor recuperado líquido da fee — não só debita a fee (achado: recordRecovery nunca creditava a recuperação em si)', async () => {
    const admin = await adminToken();
    const cedente = await registerCedente(`Fornecedora Credito Real ${unique()} Ltda`);
    const emitted = await submitEmitir(cedente, { vencimento: '2020-04-10' });

    const aceite = getAceiteByDuplicata(emitted.duplicataId)!;
    setAceiteStatus(aceite.id, 'aceita');

    const recover = await request(app).post(`/api/admin/juridico/cobranca/${emitted.duplicataId}/recuperar`).set('Authorization', `Bearer ${admin}`);
    expect(recover.status).toBe(200);
    const net = 10_000 - recover.body.feeValor;

    const extrato = await request(app).get('/api/account').set('Authorization', `Bearer ${cedente}`);
    const credit = extrato.body.extrato.find((e: { descricao: string }) => e.descricao.includes(emitted.duplicataId) && e.descricao.includes('Recuperação'));
    expect(credit).toBeTruthy();
    expect(credit.isPositive).toBe(true);
    expect(credit.valorFmt.replace(/\D/g, '')).toBe(String(Math.round(net)));
  });

  it('uma duplicata fracionada não é elegível pra cobrança jurídica ainda — recordRecovery não sabe distribuir entre os holders', async () => {
    const admin = await adminToken();
    const cedente = await registerCedente(`Fornecedora Fracionada Juridico ${unique()} Ltda`);
    const emitted = await submitEmitir(cedente, {
      vencimento: '2020-05-10',
      sacado: `Comércio Rio Preto ${unique()} Ltda`,
      cnpj: '34.567.890/0001-12',
      valor: '200.000',
    });

    const aceite = getAceiteByDuplicata(emitted.duplicataId)!;
    setAceiteStatus(aceite.id, 'aceita');

    const investor = await investorToken();
    const fracionar = await request(app)
      .post(`/api/market/${emitted.duplicataId}/fracionar`)
      .set('Authorization', `Bearer ${investor}`)
      .send({ tokens: 10 });
    expect(fracionar.status).toBe(200);

    const recover = await request(app).post(`/api/admin/juridico/cobranca/${emitted.duplicataId}/recuperar`).set('Authorization', `Bearer ${admin}`);
    expect(recover.status).toBe(409);
    expect(recover.body.error).toBe('not_eligible');
    expect(recover.body.message).toContain('fracionada');
  });

  it('quando o credor é o fundo do Confirming, o ledger interno do fundo também é atualizado (mesma consistência do pagamento no vencimento)', async () => {
    const admin = await adminToken();
    const sacadoCompany = `Sacado Juridico Confirming ${unique()}`;
    const sacadoRes = await request(app)
      .post('/api/auth/register')
      .send({ nome: 'Sacado', email: `sac-jur-conf-${unique()}@example.com`, password: 'senha123', companyName: sacadoCompany, role: 'sacado' });
    const sacadoToken = sacadoRes.body.token as string;
    const sacadoUserId = sacadoRes.body.user.id as number;
    const cedente = await registerCedente(`Fornecedora Confirming Juridico ${unique()} Ltda`);
    const cedenteMe = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${cedente}`);
    const cedenteUserId = cedenteMe.body.user.id as number;

    // CNPJ com histórico real seedado (data/seed.ts SACADOS) — necessário pra
    // buildBlendedRiscoViewSync calcular uma taxa (mesmo CNPJ usado em duplicata-payment.test.ts).
    const CNPJ_COM_HISTORICO = '12.345.678/0001-90';
    await request(app).post('/api/confirming/criar').set('Authorization', `Bearer ${sacadoToken}`).send({ cnpj: CNPJ_COM_HISTORICO, limite: '500.000' });
    await request(app).post('/api/confirming/membros').set('Authorization', `Bearer ${sacadoToken}`).send({ cedenteUserId });
    const fundoInvestorToken = await investorToken();
    await request(app).post('/api/confirming-fundo/contribuir').set('Authorization', `Bearer ${fundoInvestorToken}`).send({ valor: 50000 });

    const emitted = await submitEmitir(cedente, { vencimento: '2020-06-10', sacado: sacadoCompany, cnpj: CNPJ_COM_HISTORICO, valor: '10.000' });

    // Achado corrigido (mudança de modelo de negócio): o fundo não pula mais o leilão — só
    // compra depois que a duplicata está de fato em 'no_mercado', na taxa DINÂMICA de
    // mercado (nunca a taxa negociada do programa, que virou só um teto — db update direto
    // garante aqui que a taxa fica dentro dele, com folga, mesmo padrão de
    // confirming-auto-fund.test.ts's setDesagio).
    const aceite = getAceiteByDuplicata(emitted.duplicataId)!;
    setAceiteStatus(aceite.id, 'aceita');
    const programa = getProgramaBySacado(sacadoUserId)!;
    db.prepare('UPDATE duplicatas SET desagio = ? WHERE id = ?').run((programa.taxa_am - 0.3).toFixed(2).replace('.', ','), emitted.duplicataId);
    const leilao = await request(app).post(`/api/minhas/${emitted.duplicataId}/leilao`).set('Authorization', `Bearer ${cedente}`);
    expect(leilao.status).toBe(200);
    const { compradas } = await runFundoAutoBuyTick();
    expect(compradas).toBe(1);

    const balanceBeforeRecovery = getFundoBalance();
    const recover = await request(app).post(`/api/admin/juridico/cobranca/${emitted.duplicataId}/recuperar`).set('Authorization', `Bearer ${admin}`);
    expect(recover.status).toBe(200);
    expect(recover.body.chargedRole).toBe('investidor');

    // O ledger interno do fundo (não só a conta pessoal do sistema) precisa refletir a
    // recuperação — mesma consistência que reportPayment já garante no caminho normal.
    const net = 10_000 - recover.body.feeValor;
    expect(getFundoBalance()).toBeCloseTo(balanceBeforeRecovery + net, 6);
  });
});
