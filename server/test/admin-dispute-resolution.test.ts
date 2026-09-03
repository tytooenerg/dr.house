import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';

// POST /admin/disputes/:id/resolve (routes/admin.ts) — o admin arbitrando uma disputa real
// entre cedente e sacado — nunca tinha um teste direto: só a ferramenta equivalente do
// agente de IA (disputa-sinistro-agent.test.ts's resolver_disputa) e a listagem somente-
// leitura (sandbox-isolation-aceites.test.ts) tocavam essa área. Achado ao simular a
// plataforma inteira manualmente e perceber que a rota real usada pelo admin no
// back-office nunca tinha sido exercida por um teste automatizado.

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

async function register(role: 'cedente' | 'sacado', companyName: string) {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Teste', email: `${role}-${unique()}@example.com`, password: 'senha123', companyName, role });
  return res.body.token as string;
}

async function emitirEContestar(cedenteToken: string, sacadoToken: string, sacadoCompany: string, valor: string) {
  let duplicataId = '';
  for (let attempt = 0; attempt < 8 && !duplicataId; attempt++) {
    const res = await request(app)
      .post('/api/emitir/submit')
      .set('Authorization', `Bearer ${cedenteToken}`)
      // cnpj precisa vir preenchido pra fechar 100% do checklist de lastro (ver
      // lib/emitirCore.ts's items) — sem isso a duplicata fica 'pendente_analise' em vez de
      // 'aprovada', e nunca chegaria a um estado onde reportPayment aceitaria.
      .send({ sacado: sacadoCompany, cnpj: '99.888.777/0001-66', valor, vencimento: '2026-12-31', seguro: false, nfAnexada: true, batchValores: [] });
    if (res.status === 200) duplicataId = res.body.duplicataId;
  }
  expect(duplicataId).toBeTruthy();

  const aceites = await request(app).get('/api/aceites').set('Authorization', `Bearer ${sacadoToken}`);
  const aceite = aceites.body.aceites.find((a: { duplicataId?: string; duplicata_id?: string }) => (a.duplicataId ?? a.duplicata_id) === duplicataId);
  expect(aceite).toBeTruthy();

  const contest = await request(app).post(`/api/aceites/${aceite.id}/status`).set('Authorization', `Bearer ${sacadoToken}`).send({ status: 'contestada' });
  expect(contest.status).toBe(200);

  return { duplicataId, aceiteId: aceite.id as number };
}

describe('POST /admin/disputes/:id/resolve — arbitragem real do admin', () => {
  it('resolver a favor do cedente reestabelece o aceite e não move dinheiro nenhum sozinho — o pagamento reportado depois credita o valor de face normalmente', async () => {
    const admin = await adminToken();
    const sacadoCompany = `Sacado Disputa Cedente ${unique()} Ltda`;
    const cedenteToken = await register('cedente', `Cedente Disputa ${unique()} Ltda`);
    const sacadoToken = await register('sacado', sacadoCompany);
    const { duplicataId, aceiteId } = await emitirEContestar(cedenteToken, sacadoToken, sacadoCompany, '14.000');

    const disputesList = await request(app).get('/api/admin/disputes').set('Authorization', `Bearer ${admin}`);
    const dispute = disputesList.body.disputes.find((d: { duplicataId: string }) => d.duplicataId === duplicataId);
    expect(dispute).toBeTruthy();

    const cedenteExtratoBefore = await request(app).get('/api/account').set('Authorization', `Bearer ${cedenteToken}`);
    const cedenteCountBefore = cedenteExtratoBefore.body.extrato.length;

    const resolve = await request(app)
      .post(`/api/admin/disputes/${dispute.id}/resolve`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ decision: 'cedente', note: 'Divergência esclarecida, dados batem com a NF-e anexada.' });
    expect(resolve.status).toBe(200);

    // Resolver a disputa por si só não move dinheiro nenhum — só desbloqueia o pagamento.
    const cedenteExtratoAfterResolve = await request(app).get('/api/account').set('Authorization', `Bearer ${cedenteToken}`);
    expect(cedenteExtratoAfterResolve.body.extrato.length).toBe(cedenteCountBefore);

    // Disputa some da fila (resolvida).
    const disputesAfter = await request(app).get('/api/admin/disputes').set('Authorization', `Bearer ${admin}`);
    expect(disputesAfter.body.disputes.some((d: { id: number }) => d.id === dispute.id)).toBe(false);

    // Aceite voltou a 'aceita' — o sacado agora consegue reportar o pagamento normalmente.
    const pay = await request(app).post(`/api/aceites/${aceiteId}/pagamento`).set('Authorization', `Bearer ${sacadoToken}`);
    expect(pay.status).toBe(200);

    const cedenteExtratoAfterPay = await request(app).get('/api/account').set('Authorization', `Bearer ${cedenteToken}`);
    const credit = cedenteExtratoAfterPay.body.extrato.find(
      (e: { descricao: string; isPositive: boolean }) => e.descricao.includes(duplicataId) && e.isPositive
    );
    expect(credit).toBeTruthy();
    expect(credit.valorFmt.replace(/\D/g, '')).toBe('14000');
  });

  it('resolver a favor do sacado também não move dinheiro nenhum, mas — achado — não impede o pagamento de ser reportado depois', async () => {
    const admin = await adminToken();
    const sacadoCompany = `Sacado Disputa Sacado ${unique()} Ltda`;
    const cedenteToken = await register('cedente', `Cedente Disputa Sacado ${unique()} Ltda`);
    const sacadoToken = await register('sacado', sacadoCompany);
    const { duplicataId, aceiteId } = await emitirEContestar(cedenteToken, sacadoToken, sacadoCompany, '11.000');

    const disputesList = await request(app).get('/api/admin/disputes').set('Authorization', `Bearer ${admin}`);
    const dispute = disputesList.body.disputes.find((d: { duplicataId: string }) => d.duplicataId === duplicataId);
    expect(dispute).toBeTruthy();

    const resolve = await request(app)
      .post(`/api/admin/disputes/${dispute.id}/resolve`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ decision: 'sacado', note: 'Divergência confirmada — dados da duplicata não batiam com a NF-e.' });
    expect(resolve.status).toBe(200);

    // Ao contrário do caminho 'cedente', nada explicitamente reestabelece o aceite aqui —
    // ele fica registrado como 'contestada'. Documentando o comportamento real: como
    // checkPaymentReportEligibility só olha duplicata.status + dispute.resolved (nunca o
    // status do aceite em si), o sacado consegue reportar o pagamento mesmo assim, idêntico
    // ao caminho onde o cedente venceu a disputa — não há diferença prática entre os dois
    // vereditos hoje. Isso não foi corrigido (é uma decisão de produto, não um bug óbvio:
    // não está claro se "vencer a disputa" deveria também invalidar a duplicata) — ver nota
    // no PR.
    const pay = await request(app).post(`/api/aceites/${aceiteId}/pagamento`).set('Authorization', `Bearer ${sacadoToken}`);
    expect(pay.status).toBe(200);
  });

  it('404 pra uma disputa inexistente, 400 pra uma decisão inválida', async () => {
    const admin = await adminToken();
    const notFound = await request(app)
      .post('/api/admin/disputes/999999999/resolve')
      .set('Authorization', `Bearer ${admin}`)
      .send({ decision: 'cedente', note: 'teste' });
    expect(notFound.status).toBe(404);

    const invalid = await request(app)
      .post('/api/admin/disputes/1/resolve')
      .set('Authorization', `Bearer ${admin}`)
      .send({ decision: 'ninguem', note: 'teste' });
    expect(invalid.status).toBe(400);
  });
});
