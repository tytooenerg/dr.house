import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { db } from '../src/db/index.js';
import { createDuplicata, dispararLeilao, getDuplicata } from '../src/db/duplicatas.js';
import { ensureAceite, setAceiteStatus } from '../src/db/aceites.js';
import { reserveRate } from '../src/lib/auctionCore.js';
import { fecharLeiloes } from './helpers/auction.js';
import { credenciarInvestidor } from './helpers/investidor.js';
import { vencimentoFuturo } from './helpers/datas.js';

// Lance em lote: um fundo escolhe várias ofertas e lança em todas numa chamada, pela tela
// (POST /market/lances/lote) ou pela API de parceiros (POST /v1/lances/lote). Cada item passa
// pelo mesmo placeAuctionBid do lance único, e o lote não é tudo-ou-nada.

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function registrar(role: 'investidor' | 'cedente', credenciar = true) {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Teste', email: `${role}-${unique()}@example.com`, password: 'senha123', companyName: `${role} ${unique()}`, role });
  if (role === 'investidor' && credenciar) credenciarInvestidor(res.body.user.id);
  return { token: res.body.token as string, userId: res.body.user.id as number };
}

function duplicataEmLeilao(valor = 30_000) {
  const d = createDuplicata({
    cedenteId: null,
    cedenteNome: `Cedente ${unique()}`,
    sacadoNome: `Sacado ${unique()} Ltda`,
    sacadoCnpj: '',
    valor,
    vencimento: vencimentoFuturo(60),
    emissao: '10/08/2026',
    status: 'aprovada',
    lastroPct: 100,
    seguro: false,
  });
  setAceiteStatus(ensureAceite(d.id, 'Aceite confirmado').id, 'aceita');
  db.prepare("UPDATE duplicatas SET desagio = '3,00' WHERE id = ?").run(d.id);
  dispararLeilao(d.id, new Date(Date.now() + 3600_000).toISOString());
  return d.id;
}

function lote(token: string, lances: unknown) {
  return request(app).post('/api/market/lances/lote').set('Authorization', `Bearer ${token}`).send({ lances });
}

// Chave live da API de plataforma exige o plano Empresarial (routes/dev.ts); a de teste não.
async function chave(token: string, mode: 'live' | 'test') {
  if (mode === 'live') await request(app).post('/api/billing/checkout').set('Authorization', `Bearer ${token}`).send({ plan: 'empresarial' });
  const res = await request(app).post('/api/dev/keys/generate').set('Authorization', `Bearer ${token}`).send({ mode, scope: 'read_write', product: 'platform' });
  expect(res.status).toBe(200);
  return res.body.rawKey as string;
}

function ativos(duplicataId: string, bidderId: number) {
  return db.prepare("SELECT taxa_am FROM auction_bids WHERE duplicata_id = ? AND bidder_id = ? AND status = 'ativo'").all(duplicataId, bidderId) as { taxa_am: number }[];
}

describe('POST /market/lances/lote', () => {
  it('registra o que cabe na reserva e recusa o resto com o motivo, sem desfazer os aceitos', async () => {
    const inv = await registrar('investidor');
    const a = duplicataEmLeilao();
    const b = duplicataEmLeilao();
    const c = duplicataEmLeilao();
    const reservaC = reserveRate(c)!.taxaAm;

    const res = await lote(inv.token, [
      { duplicataId: a, taxaAm: 2.5 },
      { duplicataId: b, taxaAm: '2,75' },
      { duplicataId: c, taxaAm: reservaC + 1 },
    ]);

    expect(res.status).toBe(200);
    expect(res.body.registrados.map((r: { duplicataId: string }) => r.duplicataId)).toEqual([a, b]);
    expect(res.body.recusados).toEqual([expect.objectContaining({ duplicataId: c, error: 'above_reserve' })]);
    expect(res.body.recusados[0].message).toMatch(/reserva/);
    expect(ativos(a, inv.userId)).toEqual([{ taxa_am: 2.5 }]);
    expect(ativos(b, inv.userId)).toEqual([{ taxa_am: 2.75 }]);
    expect(ativos(c, inv.userId)).toEqual([]);
    expect(res.body.totalPrecoFmt).toMatch(/^R\$/);
    expect(Array.isArray(res.body.offers)).toBe(true);
  });

  it('sem taxa, lança na reserva de cada duplicata', async () => {
    const inv = await registrar('investidor');
    const id = duplicataEmLeilao();
    const res = await lote(inv.token, [{ duplicataId: id }]);
    expect(res.status).toBe(200);
    expect(ativos(id, inv.userId)).toEqual([{ taxa_am: reserveRate(id)!.taxaAm }]);
  });

  it('a mesma duplicata repetida no lote vira um lance só', async () => {
    const inv = await registrar('investidor');
    const id = duplicataEmLeilao();
    const res = await lote(inv.token, [{ duplicataId: id, taxaAm: 2.5 }, { duplicataId: id, taxaAm: 2.0 }]);
    expect(res.body.registrados).toHaveLength(1);
    expect(ativos(id, inv.userId)).toHaveLength(1);
  });

  it('duplicata inexistente é recusada sem derrubar o lote', async () => {
    const inv = await registrar('investidor');
    const id = duplicataEmLeilao();
    const res = await lote(inv.token, [{ duplicataId: 'DUP-NAO-EXISTE' }, { duplicataId: id, taxaAm: 2.5 }]);
    expect(res.status).toBe(200);
    expect(res.body.registrados).toHaveLength(1);
    expect(res.body.recusados[0]).toMatchObject({ duplicataId: 'DUP-NAO-EXISTE', error: 'not_found' });
  });

  it('conta sem credenciamento leva um 403 único, sem lance nenhum', async () => {
    const inv = await registrar('investidor', false);
    const id = duplicataEmLeilao();
    const res = await lote(inv.token, [{ duplicataId: id, taxaAm: 2.5 }]);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('kyb_required');
    expect(ativos(id, inv.userId)).toEqual([]);
  });

  it('lista vazia ou acima de 200 itens é recusada na validação', async () => {
    const inv = await registrar('investidor');
    expect((await lote(inv.token, [])).status).toBe(400);
    const muitos = Array.from({ length: 201 }, (_, i) => ({ duplicataId: `DUP-${i}` }));
    expect((await lote(inv.token, muitos)).status).toBe(400);
  });

  it('o fechamento do leilão adjudica os lances do lote normalmente', async () => {
    const inv = await registrar('investidor');
    const a = duplicataEmLeilao();
    const b = duplicataEmLeilao();
    await lote(inv.token, [{ duplicataId: a }, { duplicataId: b }]);
    fecharLeiloes(a);
    fecharLeiloes(b);
    expect(getDuplicata(a)!.status).toBe('vendida');
    expect(getDuplicata(b)!.status).toBe('vendida');
    const vencedores = db.prepare("SELECT COUNT(*) AS n FROM purchases WHERE investor_id = ? AND duplicata_id IN (?, ?)").get(inv.userId, a, b) as { n: number };
    expect(vencedores.n).toBe(2);
  });
});

describe('API de parceiros — /v1/lances', () => {
  it('chave live de fundo registra o lote e depois lista os lances', async () => {
    const inv = await registrar('investidor');
    const key = await chave(inv.token, 'live');
    const id = duplicataEmLeilao();

    const res = await request(app).post('/api/v1/lances/lote').set('Authorization', `Bearer ${key}`).send({ lances: [{ duplicataId: id, taxaAm: 2.5 }] });
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('live');
    expect(res.body.registrados).toHaveLength(1);

    const lista = await request(app).get('/api/v1/lances').set('Authorization', `Bearer ${key}`);
    expect(lista.status).toBe(200);
    expect(lista.body.lances.map((l: { duplicataId: string }) => l.duplicataId)).toContain(id);
  });

  it('repetir a mesma Idempotency-Key devolve o resultado original sem lançar de novo', async () => {
    const inv = await registrar('investidor');
    const key = await chave(inv.token, 'live');
    const id = duplicataEmLeilao();
    const body = { lances: [{ duplicataId: id, taxaAm: 2.5 }] };
    const idem = `lote-${unique()}`;

    const primeiro = await request(app).post('/api/v1/lances/lote').set('Authorization', `Bearer ${key}`).set('Idempotency-Key', idem).send(body);
    const segundo = await request(app).post('/api/v1/lances/lote').set('Authorization', `Bearer ${key}`).set('Idempotency-Key', idem).send(body);
    expect(segundo.body.registrados[0].bidId).toBe(primeiro.body.registrados[0].bidId);
    const todos = db.prepare('SELECT COUNT(*) AS n FROM auction_bids WHERE duplicata_id = ? AND bidder_id = ?').get(id, inv.userId) as { n: number };
    expect(todos.n).toBe(1);
  });

  it('chave de teste é recusada: lance de sandbox nunca seria adjudicado', async () => {
    const inv = await registrar('investidor');
    const key = await chave(inv.token, 'test');
    const res = await request(app).post('/api/v1/lances/lote').set('Authorization', `Bearer ${key}`).send({ lances: [{ duplicataId: duplicataEmLeilao() }] });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('sandbox_indisponivel');
  });

  it('chave de conta cedente não dá lance', async () => {
    const ced = await registrar('cedente');
    const key = await chave(ced.token, 'live');
    const res = await request(app).post('/api/v1/lances/lote').set('Authorization', `Bearer ${key}`).send({ lances: [{ duplicataId: duplicataEmLeilao() }] });
    expect(res.status).toBe(403);
  });

  it('o spec OpenAPI documenta os dois caminhos novos', async () => {
    const res = await request(app).get('/api/v1/openapi.json');
    expect(res.body.paths['/lances/lote'].post).toBeTruthy();
    expect(res.body.paths['/lances'].get).toBeTruthy();
  });
});
