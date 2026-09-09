import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import http from 'node:http';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { getAceiteByDuplicata, setAceiteStatus } from '../src/db/aceites.js';
import { getActivePurchaseByDuplicata } from '../src/db/resaleListings.js';
import { getOtcNegociacao } from '../src/db/otc.js';
import { db } from '../src/db/index.js';
import { WEBHOOK_EVENTS } from '../src/data/seed.js';
import { arrematar } from './helpers/auction.js';
import { credenciarInvestidor } from './helpers/investidor.js';

// O balcão nasceu completo pela TELA e mudo por fora. Isso o deixava pela metade justamente
// pra quem ele foi desenhado: a mesa institucional opera por integração, não olhando o site.
// Uma proposta dirigida com prazo de 48h correndo que só existe se a contraparte logar não é
// uma proposta firme — é uma aposta de que ela vai entrar no site a tempo.
//
// Estes testes cobrem as duas pontas que faltavam: os webhooks (o balcão avisando quem tem
// que reagir) e as rotas de /api/v1 (a mesa agindo sem passar pela tela).

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Investidor credenciado. `empresarial` libera /api/dev (webhooks e chave live). */
async function investidor(nome: string, empresarial = false) {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Mesa OTC', email: `inv-otcapi-${unique()}@example.com`, password: 'senha123', companyName: `${nome} ${unique()}`, role: 'investidor' });
  const token = res.body.token as string;
  credenciarInvestidor(res.body.user.id);
  if (empresarial) await request(app).post('/api/billing/checkout').set('Authorization', `Bearer ${token}`).send({ plan: 'empresarial' });
  return { token, userId: res.body.user.id as number };
}

async function chaveDe(token: string, extra: Record<string, unknown> = {}) {
  const gen = await request(app).post('/api/dev/keys/generate').set('Authorization', `Bearer ${token}`).send(extra);
  expect(gen.status).toBe(200);
  return gen.body.rawKey as string;
}

/** Emite uma duplicata e faz `dono` arrematá-la, devolvendo a posição já formada. */
async function posicaoDe(dono: { token: string }, valor = '30.000') {
  const ced = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Cedente', email: `ced-otcapi-${unique()}@example.com`, password: 'senha123', companyName: `Cedente OTC API ${unique()}`, role: 'cedente' });

  let duplicataId = '';
  for (let i = 0; i < 8 && !duplicataId; i++) {
    const res = await request(app)
      .post('/api/emitir/submit')
      .set('Authorization', `Bearer ${ced.body.token}`)
      .send({ sacado: `Sacado OTC API ${unique()}`, cnpj: '55.444.333/0001-22', valor, vencimento: '2027-12-31', seguro: false, nfAnexada: true });
    if (res.status === 200) duplicataId = res.body.duplicataId;
  }
  expect(duplicataId).toBeTruthy();
  setAceiteStatus(getAceiteByDuplicata(duplicataId)!.id, 'aceita');
  expect((await arrematar(dono.token, duplicataId)).lance.status).toBe(200);
  return duplicataId;
}

// Mesmo receptor local dos testes de webhooks-v2: um servidor HTTP de verdade, para provar a
// entrega de ponta a ponta em vez de espiar uma fila interna.
function startReceiver() {
  const received: { body: string } = { body: '' };
  let resolveReceived: () => void;
  const receivedPromise = new Promise<void>((resolve) => {
    resolveReceived = resolve;
  });
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      received.body = raw;
      res.writeHead(200);
      res.end('ok');
      resolveReceived();
    });
  });
  return { server, received, receivedPromise };
}

async function assinar(token: string, event: string) {
  const hook = startReceiver();
  await new Promise<void>((resolve) => hook.server.listen(0, '127.0.0.1', resolve));
  const port = (hook.server.address() as { port: number }).port;
  const created = await request(app)
    .post('/api/dev/webhooks')
    .set('Authorization', `Bearer ${token}`)
    .send({ url: `http://127.0.0.1:${port}/hook`, event });
  expect(created.status).toBe(200);
  return hook;
}

async function esperarEntrega(p: Promise<void>) {
  await Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(new Error('webhook não chegou a tempo')), 5000))]);
}

const otcWeb = (token: string) => ({
  abrir: (body: Record<string, unknown>) => request(app).post('/api/secundario/otc').set('Authorization', `Bearer ${token}`).send(body),
  contrapor: (id: number, body: Record<string, unknown>) =>
    request(app).post(`/api/secundario/otc/${id}/contraproposta`).set('Authorization', `Bearer ${token}`).send(body),
  aceitar: (id: number) => request(app).post(`/api/secundario/otc/${id}/aceitar`).set('Authorization', `Bearer ${token}`).send({}),
  encerrar: (id: number) => request(app).post(`/api/secundario/otc/${id}/encerrar`).set('Authorization', `Bearer ${token}`).send({}),
});

const otcApi = (key: string) => ({
  listar: () => request(app).get('/api/v1/otc').set('Authorization', `Bearer ${key}`),
  abrir: (body: Record<string, unknown>) => request(app).post('/api/v1/otc').set('Authorization', `Bearer ${key}`).send(body),
  contrapor: (id: number, body: Record<string, unknown>) =>
    request(app).post(`/api/v1/otc/${id}/contraproposta`).set('Authorization', `Bearer ${key}`).send(body),
  aceitar: (id: number) => request(app).post(`/api/v1/otc/${id}/aceitar`).set('Authorization', `Bearer ${key}`).send({}),
  encerrar: (id: number, como?: string) =>
    request(app)
      .post(`/api/v1/otc/${id}/encerrar`)
      .set('Authorization', `Bearer ${key}`)
      .send(como ? { como } : {}),
});

describe('o balcão avisa quem tem que reagir', () => {
  it('a lista de eventos assináveis inclui os quatro do balcão — sem isso a tela promete e o servidor recusa', async () => {
    const { token } = await investidor('Mesa Catalogo', true);
    for (const evento of ['otc.proposta_recebida', 'otc.contraproposta', 'otc.aceita', 'otc.encerrada']) {
      expect(WEBHOOK_EVENTS).toContain(evento);
      const hook = await assinar(token, evento);
      hook.server.close();
    }
  });

  it('otc.proposta_recebida sai pro dono da posição, com valor, prazo e de quem veio', async () => {
    const dono = await investidor('Mesa Vendedora', true);
    const interessado = await investidor('Mesa Compradora');
    const duplicataId = await posicaoDe(dono);
    const hook = await assinar(dono.token, 'otc.proposta_recebida');

    const res = await otcWeb(interessado.token).abrir({ duplicataId, valor: '25.000', prazoHoras: 24, nota: 'casando vencimento' });
    expect(res.status).toBe(200);

    await esperarEntrega(hook.receivedPromise);
    hook.server.close();
    const body = JSON.parse(hook.received.body);
    expect(body.event).toBe('otc.proposta_recebida');
    expect(body.data.negociacaoId).toBe(res.body.negociacaoId);
    expect(body.data.duplicataId).toBe(duplicataId);
    expect(body.data.valor).toBe(25000);
    // A vez é de quem recebeu: o payload precisa dizer que a bola está com ele.
    expect(body.data.vezDe).toBe('vendedor');
    expect(body.data.expiraEm).toBeTruthy();
    expect(body.data.nota).toBe('casando vencimento');
  });

  it('otc.aceita sai pras DUAS pontas — é liquidação, não pedido de resposta —, e só o vendedor paga taxa', async () => {
    const dono = await investidor('Mesa Vendedora 2', true);
    const interessado = await investidor('Mesa Compradora 2', true);
    const duplicataId = await posicaoDe(dono);

    const aberta = await otcWeb(interessado.token).abrir({ duplicataId, valor: '25.000' });
    expect(aberta.status).toBe(200);

    const doVendedor = await assinar(dono.token, 'otc.aceita');
    const doComprador = await assinar(interessado.token, 'otc.aceita');
    expect((await otcWeb(dono.token).aceitar(aberta.body.negociacaoId)).status).toBe(200);

    await esperarEntrega(doVendedor.receivedPromise);
    await esperarEntrega(doComprador.receivedPromise);
    doVendedor.server.close();
    doComprador.server.close();

    const v = JSON.parse(doVendedor.received.body).data;
    const c = JSON.parse(doComprador.received.body).data;
    expect(v.papel).toBe('vendedor');
    expect(c.papel).toBe('comprador');
    expect(v.status).toBe('aceita');
    // Quem vende arca com a taxa de plataforma; quem compra desembolsa o valor cheio.
    expect(v.taxaPlataforma).toBeGreaterThan(0);
    expect(v.liquido).toBeCloseTo(25000 - v.taxaPlataforma, 2);
    expect(c.taxaPlataforma).toBe(0);
    expect(c.liquido).toBe(25000);
  });

  it('otc.encerrada sai quando o prazo vira — a expiração é preguiçosa, e é por isso que ela precisa avisar', async () => {
    const dono = await investidor('Mesa Vendedora 3', true);
    const interessado = await investidor('Mesa Compradora 3');
    const duplicataId = await posicaoDe(dono);

    const aberta = await otcWeb(interessado.token).abrir({ duplicataId, valor: '25.000' });
    const negociacaoId = aberta.body.negociacaoId as number;
    const hook = await assinar(dono.token, 'otc.encerrada');

    // Empurra o prazo pro passado: é o relógio virando, não uma ação de ninguém — e sem o
    // aviso ninguém do lado de fora tem como descobrir que a proposta morreu.
    db.prepare("UPDATE otc_negociacoes SET expira_em = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(negociacaoId);
    // Qualquer leitura do balcão dispara a expiração.
    await request(app).get('/api/secundario').set('Authorization', `Bearer ${dono.token}`);

    await esperarEntrega(hook.receivedPromise);
    hook.server.close();
    const body = JSON.parse(hook.received.body);
    expect(body.event).toBe('otc.encerrada');
    expect(body.data.negociacaoId).toBe(negociacaoId);
    expect(body.data.motivo).toBe('expirada');
    expect(getOtcNegociacao(negociacaoId)!.status).toBe('expirada');
  });
});

describe('/api/v1 — a mesa negocia no balcão sem passar pela tela', () => {
  it('abre, contrapropõe e aceita pela API, e a posição troca de mãos de verdade', async () => {
    const dono = await investidor('Mesa API Vendedora', true);
    const interessado = await investidor('Mesa API Compradora', true);
    const duplicataId = await posicaoDe(dono, '40.000');
    const posicaoAntes = getActivePurchaseByDuplicata(duplicataId)!;
    expect(posicaoAntes.investor_id).toBe(dono.userId);

    const chaveComprador = await chaveDe(interessado.token);
    const chaveVendedor = await chaveDe(dono.token);

    const aberta = await otcApi(chaveComprador).abrir({ duplicataId, valor: 30000, prazoHoras: 24 });
    expect(aberta.status).toBe(200);
    const negociacaoId = aberta.body.negociacaoId as number;

    // Vendedor contrapropõe, comprador melhora, vendedor aceita — a vez alterna a cada rodada.
    expect((await otcApi(chaveVendedor).contrapor(negociacaoId, { valor: 36000 })).status).toBe(200);
    expect((await otcApi(chaveComprador).contrapor(negociacaoId, { valor: 34000 })).status).toBe(200);
    expect((await otcApi(chaveVendedor).aceitar(negociacaoId)).status).toBe(200);

    expect(getOtcNegociacao(negociacaoId)!.status).toBe('aceita');
    const posicaoDepois = getActivePurchaseByDuplicata(duplicataId)!;
    expect(posicaoDepois.investor_id).toBe(interessado.userId);
    expect(posicaoDepois.valor).toBe(34000);
  });

  it('GET /otc mostra só as negociações da própria conta — o balcão de terceiros não existe pra ela', async () => {
    const dono = await investidor('Mesa API Dona', true);
    const interessado = await investidor('Mesa API Parte', true);
    const estranho = await investidor('Mesa API Estranha', true);
    const duplicataId = await posicaoDe(dono);

    const aberta = await otcApi(await chaveDe(interessado.token)).abrir({ duplicataId, valor: 25000 });
    expect(aberta.status).toBe(200);
    const negociacaoId = aberta.body.negociacaoId as number;

    const daParte = await otcApi(await chaveDe(dono.token)).listar();
    expect(daParte.status).toBe(200);
    expect(daParte.body.negociacoes.map((n: { id: number }) => n.id)).toContain(negociacaoId);

    const doEstranho = await otcApi(await chaveDe(estranho.token)).listar();
    expect(doEstranho.status).toBe(200);
    expect(doEstranho.body.negociacoes.map((n: { id: number }) => n.id)).not.toContain(negociacaoId);
  });

  it('uma chave de terceiro leva 404 ao tentar agir — não 403: a existência da negociação já é informação de mercado', async () => {
    const dono = await investidor('Mesa API Dona 2', true);
    const interessado = await investidor('Mesa API Parte 2', true);
    const estranho = await investidor('Mesa API Estranha 2', true);
    const duplicataId = await posicaoDe(dono);

    const aberta = await otcApi(await chaveDe(interessado.token)).abrir({ duplicataId, valor: 25000 });
    const negociacaoId = aberta.body.negociacaoId as number;

    const chaveEstranho = await chaveDe(estranho.token);
    expect((await otcApi(chaveEstranho).aceitar(negociacaoId)).status).toBe(404);
    expect((await otcApi(chaveEstranho).contrapor(negociacaoId, { valor: 26000 })).status).toBe(404);
    expect((await otcApi(chaveEstranho).encerrar(negociacaoId)).status).toBe(404);
    // E a negociação segue viva: um terceiro não consegue matá-la nem por acidente.
    expect(getOtcNegociacao(negociacaoId)!.status).toBe('aberta');
  });

  it('chave somente-leitura não abre negociação, e chave de conta cedente não entra no balcão', async () => {
    const dono = await investidor('Mesa API Dona 3', true);
    const interessado = await investidor('Mesa API Parte 3', true);
    const duplicataId = await posicaoDe(dono);

    const soLeitura = await chaveDe(interessado.token, { scope: 'read_only' });
    expect((await otcApi(soLeitura).abrir({ duplicataId, valor: 25000 })).status).toBe(403);
    // Mas ela LÊ: acompanhar a mesa sem poder movê-la é um caso legítimo.
    expect((await otcApi(soLeitura).listar()).status).toBe(200);

    const ced = await request(app)
      .post('/api/auth/register')
      .send({ nome: 'Cedente', email: `ced-otcv1-${unique()}@example.com`, password: 'senha123', companyName: `Cedente v1 ${unique()}`, role: 'cedente' });
    await request(app).post('/api/billing/checkout').set('Authorization', `Bearer ${ced.body.token}`).send({ plan: 'empresarial' });
    const chaveCedente = await chaveDe(ced.body.token);
    expect((await otcApi(chaveCedente).listar()).status).toBe(403);
    expect((await otcApi(chaveCedente).abrir({ duplicataId, valor: 25000 })).status).toBe(403);
  });

  it('chave de teste recusa com sandbox_indisponivel em vez de inventar uma contraparte', async () => {
    const interessado = await investidor('Mesa API Sandbox', true);
    const chaveTeste = await chaveDe(interessado.token, { mode: 'test' });

    const listar = await otcApi(chaveTeste).listar();
    expect(listar.status).toBe(409);
    expect(listar.body.error).toBe('sandbox_indisponivel');

    const abrir = await otcApi(chaveTeste).abrir({ duplicataId: 'DUP-INEXISTENTE', valor: 25000 });
    expect(abrir.status).toBe(409);
    expect(abrir.body.error).toBe('sandbox_indisponivel');
  });

  it('o Idempotency-Key impede que um retry de rede sobre o aceite compre duas vezes', async () => {
    const dono = await investidor('Mesa API Idem Vendedora', true);
    const interessado = await investidor('Mesa API Idem Compradora', true);
    const duplicataId = await posicaoDe(dono);
    const chaveVendedor = await chaveDe(dono.token);

    const aberta = await otcApi(await chaveDe(interessado.token)).abrir({ duplicataId, valor: 25000 });
    const negociacaoId = aberta.body.negociacaoId as number;

    const chave = `otc-aceite-${unique()}`;
    const primeira = await request(app)
      .post(`/api/v1/otc/${negociacaoId}/aceitar`)
      .set('Authorization', `Bearer ${chaveVendedor}`)
      .set('Idempotency-Key', chave)
      .send({});
    expect(primeira.status).toBe(200);

    // O mesmo request de novo devolve o MESMO resultado, sem uma segunda liquidação.
    const repetida = await request(app)
      .post(`/api/v1/otc/${negociacaoId}/aceitar`)
      .set('Authorization', `Bearer ${chaveVendedor}`)
      .set('Idempotency-Key', chave)
      .send({});
    expect(repetida.status).toBe(200);
    // Sem idempotência, este segundo POST cairia em 'nao_aberta' — prova de que a resposta
    // veio do registro da primeira chamada, não de uma reexecução.
    expect(getOtcNegociacao(negociacaoId)!.status).toBe('aceita');
  });
});
