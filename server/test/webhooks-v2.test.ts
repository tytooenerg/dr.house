import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import http from 'node:http';
import crypto from 'node:crypto';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { approveKyb, updateKybForm } from '../src/db/users.js';
import { db } from '../src/db/index.js';
import { arrematar, darLance, fecharLeiloes } from './helpers/auction.js';
import { createDuplicata } from '../src/db/duplicatas.js';
import { ensureAceite, setAceiteStatus } from '../src/db/aceites.js';

// Duplicata pronta pra ir a leilão pelo caminho real: lastro 100% e aceite confirmado, que é
// o que routes/minhas.ts exige antes de aceitar o disparo.
function criarDuplicataAprovada(cedenteId: number): string {
  const d = createDuplicata({
    cedenteId,
    cedenteNome: 'Cedente WH2',
    sacadoNome: `Sacado WH2 ${unique()} Ltda`,
    sacadoCnpj: '',
    valor: 25000,
    vencimento: '2026-12-31',
    emissao: '10/08/2026',
    status: 'aprovada',
    lastroPct: 100,
    seguro: false,
  });
  setAceiteStatus(ensureAceite(d.id, 'Aceite confirmado na emissão').id, 'aceita');
  return d.id;
}

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function registerEmpresarialCedente() {
  const email = `ced-wh2-${unique()}@example.com`;
  const reg = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Cedente WH2', email, password: 'senha123', companyName: `Cedente WH2 ${unique()}`, role: 'cedente' });
  const token = reg.body.token as string;
  await request(app).post('/api/billing/checkout').set('Authorization', `Bearer ${token}`).send({ plan: 'empresarial' });
  return { token, userId: reg.body.user.id as number };
}

async function registerInvestidor() {
  const email = `inv-wh2-${unique()}@example.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Investidor', email, password: 'senha123', companyName: `Fundo WH2 ${unique()}`, role: 'investidor' });
  approveKyb(res.body.user.id);
  return { token: res.body.token as string, userId: res.body.user.id as number };
}

function parseDataBr(value: string): Date {
  const [d, m, y] = value.split('/');
  return new Date(`${y}-${m}-${d}`);
}

// Spins up a real local HTTP server as the webhook receiver, waits for one delivery,
// returns its parsed body + signature — same pattern as partner-api.test.ts's "real
// webhook delivery" test.
function startReceiver() {
  const received: { body: string; event: string; signature: string } = { body: '', event: '', signature: '' };
  let resolveReceived: () => void;
  const receivedPromise = new Promise<void>((resolve) => {
    resolveReceived = resolve;
  });
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      received.body = raw;
      received.event = JSON.parse(raw || '{}').event ?? '';
      received.signature = String(req.headers['x-lastro-signature'] ?? '');
      res.writeHead(200);
      res.end('ok');
      resolveReceived();
    });
  });
  return { server, received, receivedPromise };
}

async function waitForDelivery(receivedPromise: Promise<void>) {
  await Promise.race([receivedPromise, new Promise((_, reject) => setTimeout(() => reject(new Error('webhook not received in time')), 5000))]);
}

describe('Webhooks v2 — secret rotation', () => {
  it('rotates the signing secret without losing the webhook registration, and the new secret signs the next delivery', async () => {
    const { token } = await registerEmpresarialCedente();
    const { server, received, receivedPromise } = startReceiver();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;

    const created = await request(app)
      .post('/api/dev/webhooks')
      .set('Authorization', `Bearer ${token}`)
      .send({ url: `http://127.0.0.1:${port}/hook`, event: 'duplicata.registrada' });
    expect(created.status).toBe(200);
    const originalSecret = created.body.secret as string;
    const webhookId = created.body.webhooks[0].id as number;

    const rotated = await request(app).post(`/api/dev/webhooks/${webhookId}/rotate-secret`).set('Authorization', `Bearer ${token}`);
    expect(rotated.status).toBe(200);
    const newSecret = rotated.body.secret as string;
    expect(newSecret).not.toBe(originalSecret);
    expect(rotated.body.webhooks.find((w: { id: number }) => w.id === webhookId)).toBeTruthy();

    let lastStatus = 0;
    for (let attempt = 0; attempt < 8 && lastStatus !== 200; attempt++) {
      const res = await request(app)
        .post('/api/emitir/submit')
        .set('Authorization', `Bearer ${token}`)
        .send({ sacado: 'Distribuidora Bom Preço', cnpj: '', valor: '5.000', vencimento: '2026-12-31', seguro: false, nfAnexada: true });
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(200);
    await waitForDelivery(receivedPromise);
    server.close();

    // Signed with the NEW secret, proving rotation actually took effect on delivery —
    // the old secret would produce a different HMAC and fail a real partner's verification.
    const expectedSignature = crypto.createHmac('sha256', newSecret).update(received.body).digest('hex');
    expect(received.signature).toBe(expectedSignature);
  });

  it("404s rotating a webhook that isn't the caller's own", async () => {
    const owner = await registerEmpresarialCedente();
    const stranger = await registerEmpresarialCedente();
    const created = await request(app)
      .post('/api/dev/webhooks')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ url: 'https://example.com/hook', event: 'duplicata.registrada' });
    const webhookId = created.body.webhooks[0].id as number;

    const res = await request(app).post(`/api/dev/webhooks/${webhookId}/rotate-secret`).set('Authorization', `Bearer ${stranger.token}`);
    expect(res.status).toBe(404);
  });
});

describe('Webhooks v2 — sinistro.decidido', () => {
  it('fires to the cedente when the seguradora decides a real, freshly-created sinistro', async () => {
    // The seeded demo sinistro (db/seed.ts's "Comércio Vale Verde Ltda" row) has
    // cedenteId: null — it exists only to give the demo seguradora account something to
    // look at, not to belong to a real, webhook-registered cedente. So this test builds
    // its own end-to-end sinistro instead of relying on dashboard.sinistros[0]:
    // a real cedente emits a duplicata (100% lastro -> status 'aprovada') with a
    // still-future vencimento — a real seguradora never sells a policy on a loss that
    // already happened (routes/market.ts POST /:id/insure now refuses that, 409
    // 'already_overdue') — a real investidor insures it (setting insurer_key without
    // buying it — POST /:id/insure doesn't require ownership of the position), and only
    // then does the vencimento move into the past (simulating time passing after the
    // policy was already in force), which makes it claimable by the matching seguradora
    // per db/duplicatas.ts's listClaimableByInsurerKey (insurer_key set, sandbox=0,
    // sinistro_status='none', status != 'vendida', AND overdue — a sinistro is only a
    // real claim once the sacado has actually missed the payment date, not merely insured).
    const cedente = await registerEmpresarialCedente();
    let emitStatus = 0;
    let duplicataId = '';
    for (let attempt = 0; attempt < 8 && emitStatus !== 200; attempt++) {
      const res = await request(app)
        .post('/api/emitir/submit')
        .set('Authorization', `Bearer ${cedente.token}`)
        .send({ sacado: 'Distribuidora Bom Preço', cnpj: '12.345.678/0001-90', valor: '20.000', vencimento: '2026-09-10', seguro: true, nfAnexada: true });
      emitStatus = res.status;
      if (res.status === 200) duplicataId = res.body.duplicataId as string;
    }
    expect(emitStatus).toBe(200);

    const { server, received, receivedPromise } = startReceiver();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const whRes = await request(app)
      .post('/api/dev/webhooks')
      .set('Authorization', `Bearer ${cedente.token}`)
      .send({ url: `http://127.0.0.1:${port}/hook`, event: 'sinistro.decidido' });
    expect(whRes.status).toBe(200);

    const investidor = await registerInvestidor();
    const insure = await request(app)
      .post(`/api/market/${duplicataId}/insure`)
      .set('Authorization', `Bearer ${investidor.token}`)
      .send({ key: 'too' });
    expect(insure.status).toBe(200);
    db.prepare('UPDATE duplicatas SET vencimento = ? WHERE id = ?').run('2020-01-10', duplicataId);

    const seguradoraLogin = await request(app).post('/api/auth/login').send({ email: 'seguradora@lastro.demo', password: 'demo1234' });
    const dashboard = await request(app).get('/api/seguradora').set('Authorization', `Bearer ${seguradoraLogin.body.token}`);
    const sinistro = dashboard.body.sinistros.find((s: { id: string }) => s.id === duplicataId);
    expect(sinistro).toBeTruthy();

    const decide = await request(app)
      .post(`/api/seguradora/sinistro/${sinistro.id}/decidir`)
      .set('Authorization', `Bearer ${seguradoraLogin.body.token}`)
      .send({ decision: 'aprovado', note: 'Documentação conferida — webhook v2 test' });
    expect(decide.status).toBe(200);

    await waitForDelivery(receivedPromise);
    server.close();
    expect(received.event).toBe('sinistro.decidido');
  });
});

describe('Webhooks v2 — block_trade.executado', () => {
  it('fires to each swept listing\'s seller when an institutional block trade executes', async () => {
    const seller = await registerInvestidor();
    const market = await request(app).get('/api/market').set('Authorization', `Bearer ${seller.token}`);
    const buyable = market.body.offers.find((o: { canBuy: boolean; vencimento: string }) => o.canBuy && parseDataBr(o.vencimento).getTime() > Date.now());
    (await arrematar(seller.token, buyable.id)).lance;
    const secundario = await request(app).get('/api/secundario').set('Authorization', `Bearer ${seller.token}`);
    const position = secundario.body.minhasPosicoes.find((p: { duplicataId: string }) => p.duplicataId === buyable.id);
    // Above lib/blockTrade.ts's MIN_BLOCK_TRADE_VALOR (R$300.000) by itself — a single
    // listing below that threshold would correctly 409 as "below_minimum", not a bug.
    const listRes = await request(app)
      .post('/api/secundario/listar')
      .set('Authorization', `Bearer ${seller.token}`)
      .send({ purchaseId: position.purchaseId, askingValor: '350.000' });
    expect(listRes.status).toBe(200);

    // Registering a webhook requires Empresarial — upgrade the seller after listing (the
    // listing itself only requires the investidor role).
    await request(app).post('/api/billing/checkout').set('Authorization', `Bearer ${seller.token}`).send({ plan: 'empresarial' });
    const { server, received, receivedPromise } = startReceiver();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    await request(app)
      .post('/api/dev/webhooks')
      .set('Authorization', `Bearer ${seller.token}`)
      .send({ url: `http://127.0.0.1:${port}/hook`, event: 'block_trade.executado' });

    const buyer = await registerInvestidor();
    updateKybForm(buyer.userId, 'pl', '15.000.000');
    const blockTrade = await request(app)
      .post('/api/secundario/block-trade')
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({ valorMaximo: '2.000.000' });
    expect(blockTrade.status).toBe(200);

    await waitForDelivery(receivedPromise);
    server.close();
    expect(received.event).toBe('block_trade.executado');
  });
});

describe('Webhooks v2 — rating.alterado', () => {
  it('fires to a cedente with an active duplicata for a sacado once reported signals actually cross a rating band', async () => {
    const { token } = await registerEmpresarialCedente();
    // Real relationship: this cedente has an active duplicata against "Grupo Atlas
    // Varejo" (a SACADOS-matched name starting at rating AA/score 84), so it's a real
    // stakeholder in that sacado's rating, not an arbitrary bystander.
    // Retried like other emit-then-assert tests in this suite: lib/registradoras.ts
    // simulates ~12% registry instability (502 cerc_unavailable), unrelated to this test.
    let emitStatus = 0;
    for (let attempt = 0; attempt < 8 && emitStatus !== 200; attempt++) {
      const res = await request(app)
        .post('/api/emitir/submit')
        .set('Authorization', `Bearer ${token}`)
        .send({ sacado: 'Grupo Atlas Varejo', cnpj: '12.345.678/0001-90', valor: '10.000', vencimento: '2026-12-31', seguro: false });
      emitStatus = res.status;
    }
    expect(emitStatus).toBe(200);

    const { server, received, receivedPromise } = startReceiver();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    await request(app)
      .post('/api/dev/webhooks')
      .set('Authorization', `Bearer ${token}`)
      .send({ url: `http://127.0.0.1:${port}/hook`, event: 'rating.alterado' });

    const reporterKeyRes = await request(app).post('/api/dev/keys/generate').set('Authorization', `Bearer ${token}`).send({ mode: 'test' });
    const reporterKey = reporterKeyRes.body.rawKey as string;

    // Three 'protesto' signals in a row: at low network-confidence weight, the first two
    // nudge the blended score down without crossing out of the AA band (84 -> 81 -> 80);
    // the third pushes both the raw network score and the confidence weight enough to
    // cross into A (score ~72) — see lib/riscoCore.ts's blend formula for the math this
    // is exercising for real, not asserting a hand-picked number.
    let lastRating = '';
    for (let i = 0; i < 3; i++) {
      const res = await request(app)
        .post('/api/v1/sacados/12.345.678%2F0001-90/sinais')
        .set('Authorization', `Bearer ${reporterKey}`)
        .send({ tipo: 'protesto', nota: `webhook v2 test ${i}` });
      expect(res.status).toBe(200);
      lastRating = res.body.rating;
    }
    expect(lastRating).toBe('A');

    await waitForDelivery(receivedPromise);
    server.close();
    expect(received.event).toBe('rating.alterado');
  });
});

// Os três eventos do leilão eram anunciados na tela de Desenvolvedores (WEBHOOK_EVENTS em
// data/seed.ts, aceitos pelo Zod de POST /dev/webhooks) e NENHUM tinha emissor: dava pra
// assinar 'leilao.encerrado' e esperar para sempre. A doc pública já os tinha removido em
// silêncio, então as duas listas discordavam. Estes testes provam que cada um sai de verdade.
describe('Webhooks do leilão — eventos que eram anunciados e nunca disparavam', () => {
  async function assinar(token: string, event: string) {
    const { server, received, receivedPromise } = startReceiver();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const created = await request(app)
      .post('/api/dev/webhooks')
      .set('Authorization', `Bearer ${token}`)
      .send({ url: `http://127.0.0.1:${port}/hook`, event });
    expect(created.status).toBe(200);
    return { server, received, receivedPromise };
  }

  it('leilao.aberto sai quando o cedente dispara o leilão, com prazo e reserva', async () => {
    const { token, userId } = await registerEmpresarialCedente();
    const hook = await assinar(token, 'leilao.aberto');

    const d = criarDuplicataAprovada(userId);
    const res = await request(app).post(`/api/minhas/${d}/leilao`).set('Authorization', `Bearer ${token}`).send({ taxaMaxima: '2,00' });
    expect(res.status).toBe(200);

    await waitForDelivery(hook.receivedPromise);
    hook.server.close();
    const body = JSON.parse(hook.received.body);
    expect(body.event).toBe('leilao.aberto');
    expect(body.data.duplicataId).toBe(d);
    expect(body.data.reservaTaxaAm).toBeCloseTo(2, 5);
    expect(body.data.closeAt).toBeTruthy();
  });

  it('lance.recebido sai pro cedente a cada lance, com a taxa proposta', async () => {
    const { token, userId } = await registerEmpresarialCedente();
    const hook = await assinar(token, 'lance.recebido');

    const d = criarDuplicataAprovada(userId);
    await request(app).post(`/api/minhas/${d}/leilao`).set('Authorization', `Bearer ${token}`).send({ taxaMaxima: '3,00' });
    const inv = await registerInvestidor();
    const lance = await request(app).post(`/api/market/${d}/lance`).set('Authorization', `Bearer ${inv.token}`).send({ taxaAm: 2.5 });
    expect(lance.status).toBe(200);

    await waitForDelivery(hook.receivedPromise);
    hook.server.close();
    const body = JSON.parse(hook.received.body);
    expect(body.event).toBe('lance.recebido');
    expect(body.data.duplicataId).toBe(d);
    expect(body.data.taxaAm).toBeCloseTo(2.5, 5);
    expect(body.data.totalLances).toBe(1);
  });

  it('leilao.encerrado sai no fechamento, dizendo se foi arrematado ou ficou sem lance', async () => {
    const { token, userId } = await registerEmpresarialCedente();
    const arrematado = await assinar(token, 'leilao.encerrado');

    const d = criarDuplicataAprovada(userId);
    await request(app).post(`/api/minhas/${d}/leilao`).set('Authorization', `Bearer ${token}`).send({ taxaMaxima: '3,00' });
    const inv = await registerInvestidor();
    await request(app).post(`/api/market/${d}/lance`).set('Authorization', `Bearer ${inv.token}`).send({ taxaAm: 2.5 });
    fecharLeiloes(d);

    await waitForDelivery(arrematado.receivedPromise);
    arrematado.server.close();
    const vendido = JSON.parse(arrematado.received.body);
    expect(vendido.data.resultado).toBe('arrematado');
    expect(vendido.data.investorId).toBe(inv.userId);
    expect(vendido.data.taxaAm).toBeCloseTo(2.5, 5);

    // E o outro desfecho: leilão que fecha sem nenhum lance também avisa.
    const semLance = await assinar(token, 'leilao.encerrado');
    const d2 = criarDuplicataAprovada(userId);
    await request(app).post(`/api/minhas/${d2}/leilao`).set('Authorization', `Bearer ${token}`).send({ taxaMaxima: '3,00' });
    fecharLeiloes(d2);

    await waitForDelivery(semLance.receivedPromise);
    semLance.server.close();
    const vazio = JSON.parse(semLance.received.body);
    expect(vazio.data.duplicataId).toBe(d2);
    expect(vazio.data.resultado).toBe('sem_lance');
    expect(vazio.data.totalLances).toBe(0);
  });
});
