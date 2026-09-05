import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { approveKyb } from '../src/db/users.js';
import { db } from '../src/db/index.js';
import { createDuplicata, dispararLeilao, getDuplicata, isPurchased, listMarketplace } from '../src/db/duplicatas.js';
import { ensureAceite, setAceiteStatus } from '../src/db/aceites.js';
import { listActiveAuctionBids } from '../src/db/auctionBids.js';
import { reserveRate } from '../src/lib/auctionCore.js';
import { closeDueAuctions } from '../src/lib/auctionClose.js';
import { fecharLeiloes } from './helpers/auction.js';

// O leilão primário de verdade. Antes desta suíte não existia nenhuma: o "leilão" era
// BID_TEMPLATES/EXTRA_BIDDERS (data/seed.ts) desenhando concorrentes fabricados sobre um
// POST /market/:id/buy que vendia a preço fixo pra quem clicasse primeiro.

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function investidor(nome = 'Fundo') {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Investidor', email: `inv-${unique()}@example.com`, password: 'senha123', companyName: `${nome} ${unique()}`, role: 'investidor' });
  approveKyb(res.body.user.id);
  return { token: res.body.token as string, userId: res.body.user.id as number, empresa: res.body.user.companyName as string };
}

/** Uma duplicata em leilão aberto, com aceite confirmado e prazo no futuro. */
function duplicataEmLeilao(valor = 30000, prazoMs = 3600_000) {
  const d = createDuplicata({
    cedenteId: null,
    cedenteNome: `Cedente Leilão ${unique()}`,
    sacadoNome: `Sacado Leilão ${unique()} Ltda`,
    sacadoCnpj: '',
    valor,
    vencimento: '2026-12-31',
    emissao: '10/08/2026',
    status: 'aprovada',
    lastroPct: 100,
    seguro: false,
  });
  setAceiteStatus(ensureAceite(d.id, 'Aceite confirmado na emissão').id, 'aceita');
  // Taxa fixa: sem isso o deságio vem da banda dinâmica de liquidez (lib/dynamicPricing.ts),
  // que muda conforme os outros testes deste arquivo negociam.
  db.prepare("UPDATE duplicatas SET desagio = '3,00' WHERE id = ?").run(d.id);
  dispararLeilao(d.id, new Date(Date.now() + prazoMs).toISOString());
  return d.id;
}

function lance(token: string, duplicataId: string, taxaAm: number) {
  return request(app).post(`/api/market/${duplicataId}/lance`).set('Authorization', `Bearer ${token}`).send({ taxaAm });
}

describe('leilão primário — quem vence', () => {
  it('adjudica ao MENOR deságio, não a quem lançou primeiro', async () => {
    const id = duplicataEmLeilao();
    const reserva = reserveRate(id)!;
    const primeiro = await investidor('Primeiro');
    const melhor = await investidor('Melhor');

    expect((await lance(primeiro.token, id, reserva.taxaAm)).status).toBe(200);
    expect((await lance(melhor.token, id, reserva.taxaAm - 0.5)).status).toBe(200);

    expect(fecharLeiloes(id)).toMatchObject({ fechados: 1, vendidos: 1 });
    const purchase = db.prepare('SELECT investor_id, valor FROM purchases WHERE duplicata_id = ?').get(id) as { investor_id: number; valor: number };
    expect(purchase.investor_id).toBe(melhor.userId);
    expect(getDuplicata(id)!.status).toBe('vendida');
  });

  it('empate de taxa desempata por quem lançou antes', async () => {
    const id = duplicataEmLeilao();
    const reserva = reserveRate(id)!;
    const cedo = await investidor('Cedo');
    const tarde = await investidor('Tarde');

    expect((await lance(cedo.token, id, reserva.taxaAm - 0.2)).status).toBe(200);
    expect((await lance(tarde.token, id, reserva.taxaAm - 0.2)).status).toBe(200);

    fecharLeiloes(id);
    const purchase = db.prepare('SELECT investor_id FROM purchases WHERE duplicata_id = ?').get(id) as { investor_id: number };
    expect(purchase.investor_id).toBe(cedo.userId);
  });

  it('o vencedor paga o preço congelado no PRÓPRIO lance, não a reserva', async () => {
    const id = duplicataEmLeilao(40000);
    const reserva = reserveRate(id)!;
    const inv = await investidor();

    const res = await lance(inv.token, id, reserva.taxaAm - 1);
    expect(res.status).toBe(200);
    fecharLeiloes(id);

    const purchase = db.prepare('SELECT retorno FROM purchases WHERE duplicata_id = ?').get(id) as { retorno: number };
    const bid = db.prepare('SELECT preco FROM auction_bids WHERE duplicata_id = ? AND status = ?').get(id, 'vencedor') as { preco: number };
    // Deságio menor => preço maior pro cedente => retorno menor pro investidor que a reserva.
    expect(bid.preco).toBeGreaterThan(reserva.preco);
    expect(purchase.retorno).toBe(Math.round(40000 - bid.preco));
  });
});

describe('leilão primário — a reserva', () => {
  it('recusa lance com deságio pior que a reserva do cedente', async () => {
    const id = duplicataEmLeilao();
    const reserva = reserveRate(id)!;
    const inv = await investidor();

    const res = await lance(inv.token, id, reserva.taxaAm + 0.01);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('above_reserve');
    expect(listActiveAuctionBids(id)).toHaveLength(0);
  });

  it('sem nenhum lance dentro da reserva a duplicata NÃO vende — volta pro cedente em "aprovada"', async () => {
    const id = duplicataEmLeilao();
    expect(fecharLeiloes(id)).toMatchObject({ fechados: 1, vendidos: 0, semLance: 1 });
    expect(isPurchased(id)).toBe(false);
    // Volta pro estado de onde saiu: é o único em que dispararLeilao aceita reabrir, e é o
    // que faz a notificação "pode reofertar" ser verdade. Ficar em 'no_mercado' com o leilão
    // carimbado deixava a duplicata encalhada exibindo "Leilão encerrado" pra sempre.
    const d = getDuplicata(id)!;
    expect(d.status).toBe('aprovada');
    expect(d.leilao_fechado_em).toBeNull();
    expect(d.close_at).toBeNull();
    expect(listMarketplace().some((o) => o.id === id)).toBe(false);
  });

  it('depois de encerrar sem lance, o cedente reoferta e o novo leilão aceita lance de verdade', async () => {
    const id = duplicataEmLeilao();
    fecharLeiloes(id);

    // Mesmo caminho que a tela do cedente usa (routes/minhas.ts's POST /:id/leilao).
    dispararLeilao(id, new Date(Date.now() + 3600_000).toISOString());
    const inv = await investidor();
    const res = await lance(inv.token, id, reserveRate(id)!.taxaAm);
    expect(res.status).toBe(200);

    fecharLeiloes(id);
    expect(isPurchased(id)).toBe(true);
    expect(getDuplicata(id)!.status).toBe('vendida');
  });

  it('leilão já adjudicado não aceita mais lance', async () => {
    const id = duplicataEmLeilao();
    const reserva = reserveRate(id)!;
    const vencedor = await investidor('Vencedor');
    await lance(vencedor.token, id, reserva.taxaAm);
    fecharLeiloes(id);

    const atrasado = await investidor('Atrasado');
    const res = await lance(atrasado.token, id, reserva.taxaAm);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('already_purchased');
  });

  it('leilão cujo prazo já passou não aceita lance nem antes do job rodar', async () => {
    const id = duplicataEmLeilao(30000, -1000); // close_at no passado
    const inv = await investidor();
    const res = await lance(inv.token, id, reserveRate(id)!.taxaAm);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('auction_closed');
  });
});

describe('leilão primário — lances do investidor', () => {
  it('lançar de novo substitui o próprio lance em vez de acumular dois', async () => {
    const id = duplicataEmLeilao();
    const reserva = reserveRate(id)!;
    const inv = await investidor();

    await lance(inv.token, id, reserva.taxaAm);
    await lance(inv.token, id, reserva.taxaAm - 0.4);

    const ativos = listActiveAuctionBids(id);
    expect(ativos).toHaveLength(1);
    expect(ativos[0].taxa_am).toBeCloseTo(reserva.taxaAm - 0.4, 5);
  });

  it('o investidor cancela o próprio lance, e ninguém cancela o lance do outro', async () => {
    const id = duplicataEmLeilao();
    const reserva = reserveRate(id)!;
    const dono = await investidor('Dono');
    const estranho = await investidor('Estranho');

    const posted = await lance(dono.token, id, reserva.taxaAm);
    const bidId = posted.body.bidId as number;

    const alheio = await request(app).post(`/api/market/lances/${bidId}/cancelar`).set('Authorization', `Bearer ${estranho.token}`);
    expect(alheio.status).toBe(403);

    const proprio = await request(app).post(`/api/market/lances/${bidId}/cancelar`).set('Authorization', `Bearer ${dono.token}`);
    expect(proprio.status).toBe(200);
    expect(listActiveAuctionBids(id)).toHaveLength(0);
  });

  it('GET /meus-lances mostra o resultado real de cada lance depois do fechamento', async () => {
    const id = duplicataEmLeilao();
    const reserva = reserveRate(id)!;
    const vencedor = await investidor('Vence');
    const perdedor = await investidor('Perde');

    await lance(perdedor.token, id, reserva.taxaAm);
    await lance(vencedor.token, id, reserva.taxaAm - 0.5);
    fecharLeiloes(id);

    const meus = await request(app).get('/api/market/meus-lances').set('Authorization', `Bearer ${vencedor.token}`);
    expect(meus.status).toBe(200);
    expect(meus.body.lances.find((l: { duplicataId: string }) => l.duplicataId === id).status).toBe('vencedor');

    const doPerdedor = await request(app).get('/api/market/meus-lances').set('Authorization', `Bearer ${perdedor.token}`);
    expect(doPerdedor.body.lances.find((l: { duplicataId: string }) => l.duplicataId === id).status).toBe('perdedor');
  });

  it('só investidor com KYB aprovado dá lance', async () => {
    const id = duplicataEmLeilao();
    const reserva = reserveRate(id)!;

    const cedente = await request(app)
      .post('/api/auth/register')
      .send({ nome: 'Cedente', email: `ced-${unique()}@example.com`, password: 'senha123', companyName: 'C Ltda', role: 'cedente' });
    expect((await lance(cedente.body.token, id, reserva.taxaAm)).status).toBe(403);

    const semKyb = await request(app)
      .post('/api/auth/register')
      .send({ nome: 'Investidor', email: `inv-${unique()}@example.com`, password: 'senha123', companyName: 'Fundo Sem KYB', role: 'investidor' });
    const res = await lance(semKyb.body.token, id, reserva.taxaAm);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('kyb_required');
  });
});

describe('fechamento do leilão', () => {
  it('fechar duas vezes não readjudica nem cria uma segunda compra', async () => {
    const id = duplicataEmLeilao();
    const inv = await investidor();
    await lance(inv.token, id, reserveRate(id)!.taxaAm);

    fecharLeiloes(id);
    const segunda = fecharLeiloes(id);
    expect(segunda).toMatchObject({ fechados: 0, vendidos: 0 });
    const count = db.prepare('SELECT COUNT(*) as n FROM purchases WHERE duplicata_id = ?').get(id) as { n: number };
    expect(count.n).toBe(1);
  });

  it('não fecha leilão cujo prazo ainda não chegou', async () => {
    const id = duplicataEmLeilao(30000, 6 * 3600_000);
    const inv = await investidor();
    await lance(inv.token, id, reserveRate(id)!.taxaAm);

    expect(closeDueAuctions(new Date().toISOString(), id)).toMatchObject({ fechados: 0 });
    expect(isPurchased(id)).toBe(false);
  });
});
