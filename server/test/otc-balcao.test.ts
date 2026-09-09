import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { getDuplicata } from '../src/db/duplicatas.js';
import { getAceiteByDuplicata, setAceiteStatus } from '../src/db/aceites.js';
import { getActivePurchaseByDuplicata, getListingForPurchase, getListing } from '../src/db/resaleListings.js';
import { getOtcNegociacao, listOtcRodadas } from '../src/db/otc.js';
import { db } from '../src/db/index.js';
import { arrematar } from './helpers/auction.js';
import { credenciarInvestidor } from './helpers/investidor.js';

// Balcão (OTC). O book do secundário só funciona quando o DONO da posição decide vendê-la, o
// lance é uma via só (sem contraproposta) e tudo é público. Aqui a negociação é dirigida a
// uma contraparte nomeada, sobre uma posição que não precisa estar anunciada, vai e volta em
// rodadas, tem prazo e só as duas partes enxergam.

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function investidor(nome = 'Fundo') {
  const email = `inv-otc-${unique()}@example.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Investidor OTC', email, password: 'senha123', companyName: `${nome} ${unique()}`, role: 'investidor' });
  credenciarInvestidor(res.body.user.id);
  return { token: res.body.token as string, userId: res.body.user.id as number };
}

/** Emite uma duplicata e faz `dono` arrematá-la, devolvendo a posição já formada. */
async function posicaoDe(dono: { token: string }, valor = '30.000') {
  const ced = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Cedente', email: `ced-otc-${unique()}@example.com`, password: 'senha123', companyName: `Cedente OTC ${unique()}`, role: 'cedente' });

  let duplicataId = '';
  for (let i = 0; i < 8 && !duplicataId; i++) {
    const res = await request(app)
      .post('/api/emitir/submit')
      .set('Authorization', `Bearer ${ced.body.token}`)
      .send({ sacado: `Sacado OTC ${unique()}`, cnpj: '55.444.333/0001-22', valor, vencimento: '2027-12-31', seguro: false, nfAnexada: true });
    if (res.status === 200) duplicataId = res.body.duplicataId;
  }
  expect(duplicataId).toBeTruthy();
  setAceiteStatus(getAceiteByDuplicata(duplicataId)!.id, 'aceita');
  expect((await arrematar(dono.token, duplicataId)).lance.status).toBe(200);
  return duplicataId;
}

const otc = (token: string) => ({
  abrir: (body: Record<string, unknown>) => request(app).post('/api/secundario/otc').set('Authorization', `Bearer ${token}`).send(body),
  contrapor: (id: number, body: Record<string, unknown>) =>
    request(app).post(`/api/secundario/otc/${id}/contraproposta`).set('Authorization', `Bearer ${token}`).send(body),
  aceitar: (id: number) => request(app).post(`/api/secundario/otc/${id}/aceitar`).set('Authorization', `Bearer ${token}`).send({}),
  encerrar: (id: number) => request(app).post(`/api/secundario/otc/${id}/encerrar`).set('Authorization', `Bearer ${token}`).send({}),
  ver: () => request(app).get('/api/secundario').set('Authorization', `Bearer ${token}`),
});

describe('o balcão alcança uma posição que ninguém anunciou', () => {
  it('abre negociação sobre a posição de outro investidor, sem anúncio nenhum no book', async () => {
    const dono = await investidor('Vendedora');
    const interessado = await investidor('Compradora');
    const duplicataId = await posicaoDe(dono);
    const posicao = getActivePurchaseByDuplicata(duplicataId)!;

    // A premissa do achado: a posição NÃO está anunciada, então o book não a alcança.
    expect(getListingForPurchase(posicao.id)).toBeUndefined();
    const book = await request(app).get('/api/secundario').set('Authorization', `Bearer ${interessado.token}`);
    expect(book.body.market.map((m: { duplicataId: string }) => m.duplicataId)).not.toContain(duplicataId);

    const res = await otc(interessado.token).abrir({ duplicataId, valor: '25.000' });
    expect(res.status).toBe(200);
    const neg = getOtcNegociacao(res.body.negociacaoId)!;
    expect(neg.vendedor_id).toBe(dono.userId);
    expect(neg.comprador_id).toBe(interessado.userId);
    // A vez é de quem recebeu a proposta: quem propõe não decide sozinho.
    expect(neg.vez_de).toBe('vendedor');
    // A proposta de abertura já é a primeira rodada do histórico.
    expect(listOtcRodadas(neg.id)).toHaveLength(1);
  });

  it('recusa abrir sobre a própria posição e sobre duplicata que ninguém detém', async () => {
    const dono = await investidor();
    const duplicataId = await posicaoDe(dono);

    const propria = await otc(dono.token).abrir({ duplicataId, valor: '25.000' });
    expect(propria.status).toBe(409);
    expect(propria.body.error).toBe('own_position');

    const outro = await investidor();
    const inexistente = await otc(outro.token).abrir({ duplicataId: 'DUP-NAO-EXISTE', valor: '1.000' });
    expect(inexistente.status).toBe(404);
  });

  it('exige credenciamento, como o resto do secundário', async () => {
    const dono = await investidor();
    const duplicataId = await posicaoDe(dono);
    const semKyb = await request(app)
      .post('/api/auth/register')
      .send({ nome: 'Sem KYB', email: `semkyb-${unique()}@example.com`, password: 'senha123', companyName: 'Sem KYB', role: 'investidor' });

    const res = await otc(semKyb.body.token).abrir({ duplicataId, valor: '25.000' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('kyb_required');
  });
});

describe('a negociação vai e volta — é isto que o lance do book não faz', () => {
  it('alterna a vez a cada contraproposta e registra cada rodada', async () => {
    const dono = await investidor();
    const comprador = await investidor();
    const duplicataId = await posicaoDe(dono);
    const abriu = await otc(comprador.token).abrir({ duplicataId, valor: '24.000', nota: 'proposta inicial' });
    const id = abriu.body.negociacaoId as number;

    // Quem propôs não pode aceitar a própria proposta, nem contrapropor por cima dela.
    const autoAceite = await otc(comprador.token).aceitar(id);
    expect(autoAceite.status).toBe(409);
    expect(autoAceite.body.error).toBe('nao_e_sua_vez');
    expect((await otc(comprador.token).contrapor(id, { valor: '25.000' })).status).toBe(409);

    // Vendedor contrapõe: a vez volta pro comprador.
    const contra = await otc(dono.token).contrapor(id, { valor: '27.000', nota: 'abaixo disso não sai' });
    expect(contra.status).toBe(200);
    expect(getOtcNegociacao(id)!.vez_de).toBe('comprador');
    expect(getOtcNegociacao(id)!.valor).toBe(27000);

    // Comprador contrapõe de novo: a vez volta pro vendedor.
    expect((await otc(comprador.token).contrapor(id, { valor: '26.000' })).status).toBe(200);
    expect(getOtcNegociacao(id)!.vez_de).toBe('vendedor');

    const rodadas = listOtcRodadas(id);
    expect(rodadas.map((r) => r.valor)).toEqual([24000, 27000, 26000]);
    expect(rodadas.map((r) => r.papel)).toEqual(['comprador', 'vendedor', 'comprador']);
    expect(rodadas[0].nota).toBe('proposta inicial');
  });
});

describe('privacidade: balcão não aparece pra quem não está na mesa', () => {
  it('um terceiro não vê a negociação, e não consegue nem agir sobre ela', async () => {
    const dono = await investidor();
    const comprador = await investidor();
    const estranho = await investidor();
    const duplicataId = await posicaoDe(dono);
    const id = (await otc(comprador.token).abrir({ duplicataId, valor: '24.000' })).body.negociacaoId as number;

    // As duas partes veem.
    expect((await otc(comprador.token).ver()).body.minhasOtc.map((n: { id: number }) => n.id)).toContain(id);
    expect((await otc(dono.token).ver()).body.minhasOtc.map((n: { id: number }) => n.id)).toContain(id);

    // O terceiro não vê nada — nem na lista, nem no book público.
    const dele = await otc(estranho.token).ver();
    expect(dele.body.minhasOtc.map((n: { id: number }) => n.id)).not.toContain(id);
    expect(JSON.stringify(dele.body.market)).not.toContain('24.000');

    // E não consegue agir: 404, não 403 — a existência da negociação alheia já é informação.
    expect((await otc(estranho.token).aceitar(id)).status).toBe(404);
    expect((await otc(estranho.token).contrapor(id, { valor: '30.000' })).status).toBe(404);
    expect((await otc(estranho.token).encerrar(id)).status).toBe(404);
  });
});

describe('o aceite liquida de verdade, pelo mesmo caminho do book', () => {
  it('transfere a posição: o vendedor sai, o comprador entra pelo preço combinado', async () => {
    const dono = await investidor();
    const comprador = await investidor();
    const duplicataId = await posicaoDe(dono, '30.000');
    const posicaoAntes = getActivePurchaseByDuplicata(duplicataId)!;
    expect(posicaoAntes.investor_id).toBe(dono.userId);

    const id = (await otc(comprador.token).abrir({ duplicataId, valor: '26.000' })).body.negociacaoId as number;
    const aceite = await otc(dono.token).aceitar(id);
    expect(aceite.status).toBe(200);

    expect(getOtcNegociacao(id)!.status).toBe('aceita');
    const posicaoDepois = getActivePurchaseByDuplicata(duplicataId)!;
    expect(posicaoDepois.investor_id).toBe(comprador.userId);
    expect(posicaoDepois.id).not.toBe(posicaoAntes.id);
    // O comprador entra pelo preço acordado, e o retorno dele é o que falta pro valor de face.
    expect(posicaoDepois.valor).toBe(26000);
    expect(posicaoDepois.retorno).toBe(getDuplicata(duplicataId)!.valor - 26000);
    // A posição antiga fecha — o dinheiro do vendedor apareceu no extrato dele.
    const extratoVendedor = db
      .prepare('SELECT COUNT(*) as n FROM ledger WHERE user_id = ? AND descricao LIKE ?')
      .get(dono.userId, '%secundário%') as { n: number };
    expect(extratoVendedor.n).toBeGreaterThan(0);
  });

  it('aceitar uma posição que também estava anunciada cancela o anúncio — não se vende duas vezes', async () => {
    const dono = await investidor();
    const comprador = await investidor();
    const duplicataId = await posicaoDe(dono, '30.000');
    const posicao = getActivePurchaseByDuplicata(duplicataId)!;

    const anunciou = await request(app)
      .post('/api/secundario/listar')
      .set('Authorization', `Bearer ${dono.token}`)
      .send({ purchaseId: posicao.id, askingValor: '29.000' });
    expect(anunciou.status).toBe(200);
    // getListingForPurchase só devolve anúncios ATIVOS, então o id é guardado agora pra
    // conseguir reler a linha depois que ela deixar de ser ativa.
    const anuncioId = getListingForPurchase(posicao.id)!.id;

    const id = (await otc(comprador.token).abrir({ duplicataId, valor: '27.500' })).body.negociacaoId as number;
    expect((await otc(dono.token).aceitar(id)).status).toBe(200);

    expect(getListing(anuncioId)!.status).toBe('cancelado');
    expect(getListingForPurchase(posicao.id)).toBeUndefined();
    // E o anúncio some do book — ninguém pode comprar o que já foi vendido no balcão.
    const book = await request(app).get('/api/secundario').set('Authorization', `Bearer ${comprador.token}`);
    expect(book.body.market.map((m: { duplicataId: string }) => m.duplicataId)).not.toContain(duplicataId);
  });

  it('revalida no aceite: se a posição mudou de mãos no meio, a negociação morre em vez de liquidar', async () => {
    const dono = await investidor();
    const compradorOtc = await investidor();
    const outroComprador = await investidor();
    const duplicataId = await posicaoDe(dono, '30.000');
    const posicao = getActivePurchaseByDuplicata(duplicataId)!;

    const id = (await otc(compradorOtc.token).abrir({ duplicataId, valor: '26.000' })).body.negociacaoId as number;

    // Enquanto a proposta está na mesa, o dono vende a posição no book pra outra pessoa.
    await request(app)
      .post('/api/secundario/listar')
      .set('Authorization', `Bearer ${dono.token}`)
      .send({ purchaseId: posicao.id, askingValor: '28.000' });
    const listingId = getListingForPurchase(posicao.id)!.id;
    expect((await request(app).post(`/api/secundario/${listingId}/comprar`).set('Authorization', `Bearer ${outroComprador.token}`).send({})).status).toBe(200);

    // Aceitar agora tem que falhar — a posição não é mais do vendedor.
    const aceite = await otc(dono.token).aceitar(id);
    expect(aceite.status).toBe(409);
    expect(aceite.body.error).toBe('stale_position');
    expect(getOtcNegociacao(id)!.status).toBe('cancelada');
    // E a duplicata continua com quem comprou no book, não com quem propôs no balcão.
    expect(getActivePurchaseByDuplicata(duplicataId)!.investor_id).toBe(outroComprador.userId);
  });
});

describe('prazo e encerramento', () => {
  it('uma proposta vencida não pode mais ser aceita', async () => {
    const dono = await investidor();
    const comprador = await investidor();
    const duplicataId = await posicaoDe(dono);
    const id = (await otc(comprador.token).abrir({ duplicataId, valor: '24.000', prazoHoras: 1 })).body.negociacaoId as number;

    // Empurra o prazo pro passado — o equivalente em teste a esperar a validade vencer.
    db.prepare('UPDATE otc_negociacoes SET expira_em = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), id);

    const aceite = await otc(dono.token).aceitar(id);
    expect(aceite.status).toBe(409);
    expect(getOtcNegociacao(id)!.status).toBe('expirada');
    // A posição continua com o dono: nada foi liquidado.
    expect(getActivePurchaseByDuplicata(duplicataId)!.investor_id).toBe(dono.userId);
  });

  it('recusa prazo fora da faixa e impede duas propostas abertas do mesmo comprador', async () => {
    const dono = await investidor();
    const comprador = await investidor();
    const duplicataId = await posicaoDe(dono);

    const longa = await otc(comprador.token).abrir({ duplicataId, valor: '24.000', prazoHoras: 10_000 });
    expect(longa.status).toBe(400);

    expect((await otc(comprador.token).abrir({ duplicataId, valor: '24.000' })).status).toBe(200);
    const duplicada = await otc(comprador.token).abrir({ duplicataId, valor: '25.000' });
    expect(duplicada.status).toBe(409);
    expect(duplicada.body.error).toBe('ja_existe');
  });

  it('qualquer um dos dois lados encerra, e depois disso ninguém aceita', async () => {
    const dono = await investidor();
    const comprador = await investidor();
    const duplicataId = await posicaoDe(dono);
    const id = (await otc(comprador.token).abrir({ duplicataId, valor: '24.000' })).body.negociacaoId as number;

    expect((await otc(dono.token).encerrar(id)).status).toBe(200);
    expect(getOtcNegociacao(id)!.status).toBe('recusada');
    expect((await otc(dono.token).aceitar(id)).status).toBe(409);
    expect(getActivePurchaseByDuplicata(duplicataId)!.investor_id).toBe(dono.userId);
  });
});
