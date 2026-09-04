import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { db } from '../src/db/index.js';
import { getDuplicata } from '../src/db/duplicatas.js';
import { applyTacitAcceptance } from '../src/lib/aceiteCore.js';

// Simulação de uma operação real de duplicata escritural jogando o papel de TODOS os 6
// papéis da plataforma (cedente, investidor, sacado, seguradora, admin, auditor) numa
// única cadeia de chamadas HTTP reais — nenhum mock de dinheiro, cada extrato conferido
// via /api/account de verdade. Os testes isolados existentes (settlement.test.ts,
// seguradora.test.ts, admin-dispute-resolution.test.ts, dispute-proposal.test.ts,
// auditor.test.ts) já cobrem cada papel separadamente ou em combinações de 3-4; nenhum
// combina os 6 na mesma operação. É exatamente na integração entre eles — o que
// aconteceu ANTES de uma ação e como isso interage com o que outro papel faz DEPOIS —
// que os achados abaixo (H1-H4, H8) aparecem; H5 já era um achado conhecido e
// documentado em admin-dispute-resolution.test.ts, não é reportado de novo aqui.

beforeAll(async () => {
  await seedIfEmpty();
});

function unique(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function register(role: 'cedente' | 'sacado' | 'investidor', companyName: string) {
  const email = `${unique(role)}@example.com`;
  const res = await request(app).post('/api/auth/register').send({ nome: 'Teste', email, password: 'senha123', companyName, role });
  return { token: res.body.token as string, userId: res.body.user.id as number };
}

async function emitirComRetry(token: string, body: Record<string, unknown>) {
  let res = await request(app).post('/api/emitir/submit').set('Authorization', `Bearer ${token}`).send(body);
  for (let attempt = 0; attempt < 5 && res.status !== 200; attempt++) {
    res = await request(app).post('/api/emitir/submit').set('Authorization', `Bearer ${token}`).send(body);
  }
  return res;
}

async function adminLogin() {
  const res = await request(app).post('/api/auth/login').send({ email: 'admin@lastro.demo', password: 'demo1234' });
  return res.body.token as string;
}

async function seguradoraLogin() {
  const res = await request(app).post('/api/auth/login').send({ email: 'seguradora@lastro.demo', password: 'demo1234' });
  return res.body.token as string;
}

// Aprovação de KYB via o endpoint HTTP real do admin (POST /api/admin/kyb/:userId/approve),
// em vez do atalho approveKyb() direto no módulo db/users.js que outros testes usam — aqui
// o próprio objetivo é simular o papel do admin de ponta a ponta, não só desbloquear o
// investidor pra poder comprar.
async function registrarInvestidorAprovado(companyName: string) {
  const admin = await adminLogin();
  const investidor = await register('investidor', companyName);
  await request(app).post('/api/auth/kyb').set('Authorization', `Bearer ${investidor.token}`).send({ cnpj: '12.345.678/0001-90', tipo: 'Fundo (FIDC)', pl: '2.000.000' });
  const approve = await request(app).post(`/api/admin/kyb/${investidor.userId}/approve`).set('Authorization', `Bearer ${admin}`);
  expect(approve.status).toBe(200);
  return investidor;
}

describe('Operação completa — 6 papéis numa única cadeia real', () => {
  it('cedente emite → leiloa → investidor A compra e segura → sacado aceita → investidor A revende → investidor B paga no vencimento → auditor vê tudo', async () => {
    const sacadoCompany = unique('Sacado Full');
    const cedente = await register('cedente', unique('Cedente Full'));
    const investidorA = await registrarInvestidorAprovado(unique('Fundo A Full'));
    const investidorB = await registrarInvestidorAprovado(unique('Fundo B Full'));

    // 1. CEDENTE emite e dispara o leilão.
    const emit = await emitirComRetry(cedente.token, {
      sacado: sacadoCompany,
      cnpj: '44.333.222/0001-11',
      valor: '50.000',
      vencimento: '2026-12-20',
      seguro: false,
      nfAnexada: true,
      batchValores: [],
    });
    expect(emit.status).toBe(200);
    const duplicataId = emit.body.duplicataId as string;

    const leilao = await request(app).post(`/api/minhas/${duplicataId}/leilao`).set('Authorization', `Bearer ${cedente.token}`);
    expect(leilao.status).toBe(200);
    expect(getDuplicata(duplicataId)!.status).toBe('no_mercado');

    // 2. INVESTIDOR A compra — extrato de ambos os lados confere o movimento real.
    const buy = await request(app).post(`/api/market/${duplicataId}/buy`).set('Authorization', `Bearer ${investidorA.token}`);
    expect(buy.status).toBe(200);
    expect(getDuplicata(duplicataId)!.status).toBe('vendida');

    const investidorAExtrato = await request(app).get('/api/account').set('Authorization', `Bearer ${investidorA.token}`);
    const debitoCompra = investidorAExtrato.body.extrato.find((e: { descricao: string; isPositive: boolean }) => e.descricao.includes(duplicataId) && !e.isPositive);
    expect(debitoCompra).toBeTruthy();

    const cedenteExtrato = await request(app).get('/api/account').set('Authorization', `Bearer ${cedente.token}`);
    const creditoVenda = cedenteExtrato.body.extrato.find((e: { descricao: string; isPositive: boolean }) => e.descricao.includes(duplicataId) && e.isPositive);
    expect(creditoVenda).toBeTruthy();

    // 3. SACADO aceita explicitamente.
    const sacado = await register('sacado', sacadoCompany);
    const aceites = await request(app).get('/api/aceites').set('Authorization', `Bearer ${sacado.token}`);
    const aceite = aceites.body.aceites.find((a: { duplicataId: string }) => a.duplicataId === duplicataId);
    expect(aceite).toBeTruthy();
    const decide = await request(app).post(`/api/aceites/${aceite.id}/status`).set('Authorization', `Bearer ${sacado.token}`).send({ status: 'aceita' });
    expect(decide.status).toBe(200);

    // 4. INVESTIDOR A contrata seguro sobre a própria posição.
    const insure = await request(app).post(`/api/market/${duplicataId}/insure`).set('Authorization', `Bearer ${investidorA.token}`).send({ key: 'too' });
    expect(insure.status).toBe(200);

    const seguradoraExtratoAntes = await request(app).get('/api/account').set('Authorization', `Bearer ${await seguradoraLogin()}`);
    const premioCreditado = seguradoraExtratoAntes.body.extrato.some((e: { descricao: string }) => e.descricao.includes(duplicataId));
    expect(premioCreditado).toBe(true);

    // 5. INVESTIDOR A revende no secundário; INVESTIDOR B compra.
    const secundario = await request(app).get('/api/secundario').set('Authorization', `Bearer ${investidorA.token}`);
    const posicao = secundario.body.minhasPosicoes.find((p: { duplicataId: string }) => p.duplicataId === duplicataId);
    expect(posicao).toBeTruthy();
    const listar = await request(app)
      .post('/api/secundario/listar')
      .set('Authorization', `Bearer ${investidorA.token}`)
      .send({ purchaseId: posicao.purchaseId, askingValor: '48.000' });
    const listing = listar.body.market.find((l: { duplicataId: string }) => l.duplicataId === duplicataId);
    expect(listing).toBeTruthy();

    const comprarRevenda = await request(app).post(`/api/secundario/${listing.id}/comprar`).set('Authorization', `Bearer ${investidorB.token}`);
    expect(comprarRevenda.status).toBe(200);

    // 6. Vencimento chega; SACADO reporta pagamento — quem recebe é o credor ATUAL
    // (investidor B, que arrematou na revenda), não o investidor A nem o cedente.
    db.prepare("UPDATE duplicatas SET vencimento = date('now', '-1 day') WHERE id = ?").run(duplicataId);
    const pagar = await request(app).post(`/api/aceites/${aceite.id}/pagamento`).set('Authorization', `Bearer ${sacado.token}`);
    expect(pagar.status).toBe(200);

    const investidorBExtrato = await request(app).get('/api/account').set('Authorization', `Bearer ${investidorB.token}`);
    const creditoVencimento = investidorBExtrato.body.extrato.find(
      (e: { descricao: string; isPositive: boolean }) => e.descricao.includes(duplicataId) && e.descricao.includes('vencimento') && e.isPositive
    );
    expect(creditoVencimento).toBeTruthy();
    expect(creditoVencimento.valorFmt.replace(/\D/g, '')).toBe('50000');

    // 7. ADMIN cria uma conta de AUDITOR real; o auditor confere que a operação ficou
    // registrada e a hash-chain do audit log está íntegra.
    const admin = await adminLogin();
    const auditorEmail = `auditor-full-${unique('x')}@example.com`;
    const criarAuditor = await request(app)
      .post('/api/admin/auditores')
      .set('Authorization', `Bearer ${admin}`)
      .send({ nome: 'Auditoria Full', email: auditorEmail, password: 'senhaforte123' });
    expect(criarAuditor.status).toBe(201);
    const loginAuditor = await request(app).post('/api/auth/login').send({ email: auditorEmail, password: 'senhaforte123' });
    const auditorToken = loginAuditor.body.token as string;

    const overview = await request(app).get('/api/auditor/overview').set('Authorization', `Bearer ${auditorToken}`);
    expect(overview.status).toBe(200);
    expect(overview.body.auditLog.chain.valid).toBe(true);
    const acoes = overview.body.auditLog.entries.map((e: { action: string }) => e.action);
    expect(acoes).toContain('aceite.aceita');
    expect(acoes).toContain('duplicata.pagamento_reportado');
  });
});

describe('Achados cross-role expostos por esta simulação (documentação — não corrigidos aqui)', () => {
  // H1 original ("sinistro credita sempre o cedente, nunca currentCreditorFor") estava
  // parcialmente errada: listClaimableByInsurerKey (db/duplicatas.ts:181-188) exclui
  // explicitamente status='vendida' da lista de sinistros reclamáveis — "a policy becomes
  // claimable ... it was never sold". Rodar o teste revelou o achado real, mais grave:
  // /market/:id/insure aceita e cobra um prêmio de verdade pra segurar uma duplicata que
  // JÁ FOI VENDIDA (o próprio investidor que a comprou pode segurá-la) — mas por desenho
  // essa apólice NUNCA pode virar sinistro reclamável, pra sempre, mesmo com o vencimento
  // vencido. O investidor paga por uma cobertura estruturalmente impossível de acionar.
  it('Achado: segurar uma duplicata já vendida cobra um prêmio real do investidor, mas a apólice nunca pode virar sinistro reclamável — listClaimableByInsurerKey exclui status=\'vendida\' pra sempre (ver db/duplicatas.ts:181-188 e routes/market.ts:104-144, que nunca bloqueia contratar seguro pós-venda)', async () => {
    const sacadoCompany = unique('Sacado H1');
    const cedente = await register('cedente', unique('Cedente H1'));
    const investidor = await registrarInvestidorAprovado(unique('Fundo H1'));

    const emit = await emitirComRetry(cedente.token, {
      sacado: sacadoCompany,
      cnpj: '55.666.777/0001-88',
      valor: '30.000',
      vencimento: '2026-12-20',
      seguro: false,
      nfAnexada: true,
      batchValores: [],
    });
    const duplicataId = emit.body.duplicataId as string;
    await request(app).post(`/api/minhas/${duplicataId}/leilao`).set('Authorization', `Bearer ${cedente.token}`);

    // O investidor compra — status vira 'vendida'.
    const buy = await request(app).post(`/api/market/${duplicataId}/buy`).set('Authorization', `Bearer ${investidor.token}`);
    expect(buy.status).toBe(200);
    expect(getDuplicata(duplicataId)!.status).toBe('vendida');

    // Mesmo assim, contratar seguro é aceito normalmente e cobra o prêmio real — nenhuma
    // checagem de status barra isso.
    const insure = await request(app).post(`/api/market/${duplicataId}/insure`).set('Authorization', `Bearer ${investidor.token}`).send({ key: 'too' });
    expect(insure.status).toBe(200);

    const investidorExtratoAposSeguro = await request(app).get('/api/account').set('Authorization', `Bearer ${investidor.token}`);
    const premioDebitado = investidorExtratoAposSeguro.body.extrato.find(
      (e: { descricao: string; isPositive: boolean }) => e.descricao.includes(duplicataId) && !e.isPositive
    );
    expect(premioDebitado).toBeTruthy(); // prêmio real, já saiu do bolso do investidor

    db.prepare("UPDATE duplicatas SET vencimento = ? WHERE id = ?").run('2020-01-10', duplicataId);

    // Achado: mesmo com vencimento vencido e apólice ativa, essa duplicata NUNCA aparece
    // pra seguradora como sinistro reclamável — porque já foi vendida.
    const seguradoraToken = await seguradoraLogin();
    const dashboard = await request(app).get('/api/seguradora').set('Authorization', `Bearer ${seguradoraToken}`);
    expect(dashboard.body.sinistros.some((s: { id: string }) => s.id === duplicataId)).toBe(false);

    const decidir = await request(app)
      .post(`/api/seguradora/sinistro/${duplicataId}/decidir`)
      .set('Authorization', `Bearer ${seguradoraToken}`)
      .send({ decision: 'aprovado', note: 'Documentação conferida.' });
    // Achado: 404 pra sempre — a apólice paga é estruturalmente inacionável, e nada no
    // fluxo de contratação avisou o investidor disso.
    expect(decidir.status).toBe(404);
  });

  it('Achado: uma duplicata já indenizada por sinistro pode ser "recuperada" de novo via cobrança jurídica — checkCollectionEligibility nunca olha duplicata.status, e recordRecovery só se protege por uma flag separada (hasFeeAlreadyCharged) que o sinistro nunca seta (ver lib/legalCollection.ts:30-52 e lib/legalCollectionFee.ts:58-59)', async () => {
    const sacadoCompany = unique('Sacado H3');
    const cedente = await register('cedente', unique('Cedente H3'));

    const emit = await emitirComRetry(cedente.token, {
      sacado: sacadoCompany,
      cnpj: '66.777.888/0001-99',
      valor: '25.000',
      vencimento: '2026-12-20',
      seguro: false,
      nfAnexada: true,
      batchValores: [],
    });
    const duplicataId = emit.body.duplicataId as string;

    // Segura direto (sem vender no mercado) — mesmo caminho de seguradora.test.ts, pra
    // isolar H3 do H1 (aqui o credor atual É o cedente, então a dupla recuperação não
    // depende de H1 pra ser real).
    const investidor = await registrarInvestidorAprovado(unique('Fundo H3'));
    await request(app).post(`/api/market/${duplicataId}/insure`).set('Authorization', `Bearer ${investidor.token}`).send({ key: 'too' });
    db.prepare("UPDATE duplicatas SET vencimento = ? WHERE id = ?").run('2020-01-10', duplicataId);

    const seguradoraToken = await seguradoraLogin();
    const decidir = await request(app)
      .post(`/api/seguradora/sinistro/${duplicataId}/decidir`)
      .set('Authorization', `Bearer ${seguradoraToken}`)
      .send({ decision: 'aprovado', note: 'Documentação conferida.' });
    expect(decidir.status).toBe(200);
    expect(getDuplicata(duplicataId)!.status).toBe('paga');

    // Sacado nunca aceitou explicitamente — mas o sinistro não depende disso. Pra que
    // checkCollectionEligibility não rejeite por "aceite não confirmado", o sacado aceita
    // agora (o admin, num caso real, poderia ter o duplicataId de uma tela aberta antes do
    // sinistro ser decidido, ou de um agente de cobrança automático rodando em paralelo).
    const sacado = await register('sacado', sacadoCompany);
    const aceites = await request(app).get('/api/aceites').set('Authorization', `Bearer ${sacado.token}`);
    const aceite = aceites.body.aceites.find((a: { duplicataId: string }) => a.duplicataId === duplicataId);
    if (aceite && aceite.status !== 'aceita') {
      await request(app).post(`/api/aceites/${aceite.id}/status`).set('Authorization', `Bearer ${sacado.token}`).send({ status: 'aceita' });
    }

    const cedenteExtratoAntes = await request(app).get('/api/account').set('Authorization', `Bearer ${cedente.token}`);
    const totalAntes = cedenteExtratoAntes.body.extrato.length;

    // ADMIN chama a recuperação jurídica diretamente pelo duplicataId — sem passar pela
    // listagem GET /admin/juridico/cobranca primeiro (que já teria filtrado essa duplicata
    // por status !== 'aprovada'/'vendida'), simulando um admin ou agente de IA que já
    // guardou o ID de antes do sinistro ser decidido.
    const admin = await adminLogin();
    const recuperar = await request(app)
      .post(`/api/admin/juridico/cobranca/${duplicataId}/recuperar`)
      .set('Authorization', `Bearer ${admin}`)
      .send({});

    // Achado: em vez de 409 (já recuperada / não elegível), o endpoint aceita e credita o
    // cedente uma SEGUNDA vez pelo mesmo valor — dinheiro real duplicado.
    expect(recuperar.status).toBe(200);

    const cedenteExtratoDepois = await request(app).get('/api/account').set('Authorization', `Bearer ${cedente.token}`);
    expect(cedenteExtratoDepois.body.extrato.length).toBeGreaterThan(totalAntes);
    const segundaCredito = cedenteExtratoDepois.body.extrato.find(
      (e: { descricao: string; isPositive: boolean }) => e.descricao.includes(duplicataId) && e.descricao.includes('Recuperação') && e.isPositive
    );
    expect(segundaCredito).toBeTruthy();
  });

  it('Achado: um investidor pode contratar seguro sobre uma duplicata que nunca comprou — /market/:id/insure nunca valida posse via currentCreditorFor (ver routes/market.ts:104-144)', async () => {
    const sacadoCompany = unique('Sacado H2');
    const cedente = await register('cedente', unique('Cedente H2'));
    const investidorA = await registrarInvestidorAprovado(unique('Fundo H2 A'));
    const investidorB = await registrarInvestidorAprovado(unique('Fundo H2 B — nunca compra nada'));

    const emit = await emitirComRetry(cedente.token, {
      sacado: sacadoCompany,
      cnpj: '77.888.999/0001-00',
      valor: '12.000',
      vencimento: '2026-12-20',
      seguro: false,
      nfAnexada: true,
      batchValores: [],
    });
    const duplicataId = emit.body.duplicataId as string;
    await request(app).post(`/api/minhas/${duplicataId}/leilao`).set('Authorization', `Bearer ${cedente.token}`);
    const buy = await request(app).post(`/api/market/${duplicataId}/buy`).set('Authorization', `Bearer ${investidorA.token}`);
    expect(buy.status).toBe(200);

    // Investidor B nunca comprou nada desta duplicata — mesmo assim consegue segurá-la.
    const insure = await request(app).post(`/api/market/${duplicataId}/insure`).set('Authorization', `Bearer ${investidorB.token}`).send({ key: 'pottencial' });
    expect(insure.status).toBe(200);
  });

  it('Achado: uma duplicata contestada pelo sacado pode ser vendida no mercado secundário mesmo assim — só o mercado primário (routes/market.ts:75-78) checa aceite.status; lib/resaleCore.ts nunca faz essa checagem', async () => {
    const sacadoCompany = unique('Sacado H4');
    const cedente = await register('cedente', unique('Cedente H4'));
    const investidorA = await registrarInvestidorAprovado(unique('Fundo H4 A'));
    const investidorB = await registrarInvestidorAprovado(unique('Fundo H4 B'));

    const emit = await emitirComRetry(cedente.token, {
      sacado: sacadoCompany,
      cnpj: '88.999.000/0001-11',
      valor: '9.000',
      vencimento: '2026-12-20',
      seguro: false,
      nfAnexada: true,
      batchValores: [],
    });
    const duplicataId = emit.body.duplicataId as string;
    await request(app).post(`/api/minhas/${duplicataId}/leilao`).set('Authorization', `Bearer ${cedente.token}`);
    await request(app).post(`/api/market/${duplicataId}/buy`).set('Authorization', `Bearer ${investidorA.token}`);

    const secundario = await request(app).get('/api/secundario').set('Authorization', `Bearer ${investidorA.token}`);
    const posicao = secundario.body.minhasPosicoes.find((p: { duplicataId: string }) => p.duplicataId === duplicataId);
    const listar = await request(app)
      .post('/api/secundario/listar')
      .set('Authorization', `Bearer ${investidorA.token}`)
      .send({ purchaseId: posicao.purchaseId, askingValor: '9.000' });
    const listing = listar.body.market.find((l: { duplicataId: string }) => l.duplicataId === duplicataId);
    expect(listing).toBeTruthy();

    // SACADO contesta DEPOIS de a duplicata já estar listada no secundário.
    const sacado = await register('sacado', sacadoCompany);
    const aceites = await request(app).get('/api/aceites').set('Authorization', `Bearer ${sacado.token}`);
    const aceite = aceites.body.aceites.find((a: { duplicataId: string }) => a.duplicataId === duplicataId);
    const contestar = await request(app).post(`/api/aceites/${aceite.id}/status`).set('Authorization', `Bearer ${sacado.token}`).send({ status: 'contestada' });
    expect(contestar.status).toBe(200);

    // Achado: INVESTIDOR B compra o listing mesmo assim — não é avisado de que a duplicata
    // está contestada. O mesmo comprador tentando o mercado PRIMÁRIO seria bloqueado com
    // 409 'contested' (routes/market.ts:75-78); no secundário, passa.
    const comprar = await request(app).post(`/api/secundario/${listing.id}/comprar`).set('Authorization', `Bearer ${investidorB.token}`);
    expect(comprar.status).toBe(200);
  });

  it('Achado (cobertura, não dinheiro): o auditor não tem nenhuma visão de disputas — GET /auditor/overview não expõe nada equivalente a GET /admin/disputes (ver lib/auditorOverview.ts)', async () => {
    const sacadoCompany = unique('Sacado H8');
    const cedente = await register('cedente', unique('Cedente H8'));
    const sacado = await register('sacado', sacadoCompany);

    const emit = await emitirComRetry(cedente.token, {
      sacado: sacadoCompany,
      cnpj: '99.000.111/0001-22',
      valor: '7.000',
      vencimento: '2026-12-20',
      seguro: false,
      nfAnexada: true,
      batchValores: [],
    });
    const duplicataId = emit.body.duplicataId as string;
    const aceites = await request(app).get('/api/aceites').set('Authorization', `Bearer ${sacado.token}`);
    const aceite = aceites.body.aceites.find((a: { duplicataId: string }) => a.duplicataId === duplicataId);
    const contestar = await request(app).post(`/api/aceites/${aceite.id}/status`).set('Authorization', `Bearer ${sacado.token}`).send({ status: 'contestada' });
    expect(contestar.status).toBe(200);

    // ADMIN vê a disputa em aberto normalmente.
    const admin = await adminLogin();
    const disputasAdmin = await request(app).get('/api/admin/disputes').set('Authorization', `Bearer ${admin}`);
    expect(disputasAdmin.body.disputes.some((d: { duplicataId: string }) => d.duplicataId === duplicataId)).toBe(true);

    // AUDITOR não vê nada relacionado — nenhuma chave do overview referencia disputas.
    const auditorEmail = `auditor-h8-${unique('x')}@example.com`;
    await request(app).post('/api/admin/auditores').set('Authorization', `Bearer ${admin}`).send({ nome: 'Auditor H8', email: auditorEmail, password: 'senhaforte123' });
    const loginAuditor = await request(app).post('/api/auth/login').send({ email: auditorEmail, password: 'senhaforte123' });
    const overview = await request(app).get('/api/auditor/overview').set('Authorization', `Bearer ${loginAuditor.body.token}`);
    expect(overview.status).toBe(200);
    expect(Object.keys(overview.body)).toEqual(['auditLog', 'compliance', 'reconciliation', 'sars']);
  });

  // Não é um bug — é uma garantia de segurança que vale travar como regressão: o job de
  // aceite tácito só pega aceites com status='aguardando' (db/aceites.ts's
  // listAguardandoComPrazo), então uma contestação manual feita bem no limite do prazo não
  // pode ser silenciosamente sobrescrita por 'aceita' quando o job roda logo em seguida.
  it('Verificado, sem achado: contestação manual no limite do prazo não é sobrescrita pelo job de aceite tácito', async () => {
    const sacadoCompany = unique('Sacado H6');
    const cedente = await register('cedente', unique('Cedente H6'));
    const sacado = await register('sacado', sacadoCompany);

    const emit = await emitirComRetry(cedente.token, {
      sacado: sacadoCompany,
      cnpj: '10.111.222/0001-33',
      valor: '6.000',
      vencimento: '2026-12-20',
      seguro: false,
      nfAnexada: true,
      batchValores: [],
    });
    const duplicataId = emit.body.duplicataId as string;

    db.prepare("UPDATE aceites SET prazo_limite = datetime('now', '-1 day') WHERE duplicata_id = ?").run(duplicataId);

    const aceites = await request(app).get('/api/aceites').set('Authorization', `Bearer ${sacado.token}`);
    const aceite = aceites.body.aceites.find((a: { duplicataId: string }) => a.duplicataId === duplicataId);
    const contestar = await request(app).post(`/api/aceites/${aceite.id}/status`).set('Authorization', `Bearer ${sacado.token}`).send({ status: 'contestada' });
    expect(contestar.status).toBe(200);

    applyTacitAcceptance();

    const depois = await request(app).get('/api/aceites').set('Authorization', `Bearer ${sacado.token}`);
    expect(depois.body.aceites.find((a: { duplicataId: string }) => a.duplicataId === duplicataId).status).toBe('contestada');
  });
});
