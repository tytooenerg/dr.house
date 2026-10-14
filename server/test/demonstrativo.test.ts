import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { getDuplicata } from '../src/db/duplicatas.js';
import { getAceiteByDuplicata, setAceiteStatus } from '../src/db/aceites.js';
import { listLedger, listNotifications } from '../src/db/misc.js';
import { demonstrativoPrimario, demonstrativoRevenda } from '../src/lib/demonstrativo.js';
import { computePurchasePrice } from '../src/lib/marketCompute.js';
import { parseFlexibleDate } from '../src/lib/format.js';
import type { DuplicataRow } from '../src/db/types.js';
import { darLance, fecharLeiloes, garantirLeilao } from './helpers/auction.js';
import { credenciarInvestidor } from './helpers/investidor.js';
import { vencimentoFuturo } from './helpers/datas.js';

// "Quem paga quanto e quem recebe quanto": o demonstrativo que o leilão e o secundário
// mostram tem que ser a MESMA conta que a liquidação aplica — senão é só um número bonito.

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const sp = (s: string) => s.replace(/\u00a0/g, ' ');
const valores = (d: { linhas: { rotulo: string; valorFmt: string }[] }) => Object.fromEntries(d.linhas.map((l) => [l.rotulo, l.valorFmt.replace(/ /g, ' ')]));

describe('demonstrativoPrimario — a conta do leilão', () => {
  it('o exemplo do Michel: R$ 1.000, 30 dias, 2% a.m. → banco paga 980, taxa 3,50, empresa recebe 976,50', () => {
    const d = { valor: 1000, vencimento: '2026-12-31' } as DuplicataRow;
    const agora = parseFlexibleDate(d.vencimento).getTime() - 30 * 86_400_000;
    const dem = demonstrativoPrimario(d.valor, computePurchasePrice(d, 2, agora));
    expect(dem).toMatchObject({ valorFace: 1000, compradorPaga: 980, taxaPlataforma: 3.5, vendedorRecebe: 976.5, ganhoComprador: 20 });
    expect(valores(dem)).toEqual({
      'Valor da duplicata': 'R$ 1.000,00',
      'Deságio do banco/fundo': '− R$ 20,00',
      'Banco/fundo paga hoje': 'R$ 980,00',
      'Taxa da plataforma Lastro': '− R$ 3,50',
      'Empresa recebe': 'R$ 976,50',
    });
    expect(dem.linhas[1].detalhe).toBe('2,00% a.m. × 30 dias = 2,00%');
    expect(dem.linhas[3].detalhe).toBe('0,35% sobre o valor da duplicata');
    expect(sp(dem.rodape)).toBe('No vencimento o banco/fundo recebe R$ 1.000,00 do sacado — ganho de R$ 20,00 (2,04% no período).');
  });

  it('a taxa da plataforma segue as faixas por valor de face', () => {
    const calc = (valor: number) => ({ precoCompra: valor * 0.98, descontoValor: valor * 0.02, descontoPct: 0.02, taxaAmPct: 2, prazoDias: 30 });
    expect(demonstrativoPrimario(500_000, calc(500_000)).taxaPlataforma).toBeCloseTo(1500, 6); // 0,30%
    expect(demonstrativoPrimario(2_000_000, calc(2_000_000)).taxaPlataforma).toBeCloseTo(5000, 6); // 0,25%
  });

  it('avisa quando o deságio bateu no limite máximo (60%)', () => {
    const d = { valor: 1000, vencimento: '2026-12-31' } as DuplicataRow;
    const agora = parseFlexibleDate(d.vencimento).getTime() - 900 * 86_400_000;
    const dem = demonstrativoPrimario(d.valor, computePurchasePrice(d, 5, agora));
    expect(dem.compradorPaga).toBeCloseTo(400, 6);
    expect(dem.linhas[1].detalhe).toContain('limite máximo de deságio');
  });
});

describe('demonstrativoRevenda — a conta do secundário', () => {
  it('comprador paga o preço, a taxa sai do vendedor, e o ganho é face − preço', () => {
    const dem = demonstrativoRevenda(1000, 990);
    expect(dem).toMatchObject({ compradorPaga: 990, vendedorRecebe: 990 - 3.465, ganhoComprador: 10 });
    expect(valores(dem)['Vendedor recebe']).toBe('R$ 986,54');
    expect(dem.linhas[1].detalhe).toBe('deságio de 1,00% sobre o valor da duplicata');
  });

  it('preço acima do valor de face: chama de ágio e diz que o comprador recebe menos do que pagou', () => {
    const dem = demonstrativoRevenda(1000, 1010);
    expect(dem.linhas[1].detalhe).toBe('ágio de 1,00% sobre o valor da duplicata');
    expect(sp(dem.rodape)).toContain('R$ 10,00 a menos do que pagou');
  });
});

async function registrar(role: 'investidor' | 'cedente') {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Teste', email: `dem-${role}-${unique()}@example.com`, password: 'senha123', companyName: `Dem ${role} ${unique()} Ltda`, role });
  if (role === 'investidor') credenciarInvestidor(res.body.user.id);
  return { token: res.body.token as string, userId: res.body.user.id as number };
}

async function emitir(cedenteToken: string, valor = '10.000') {
  for (let i = 0; i < 8; i++) {
    const res = await request(app)
      .post('/api/emitir/submit')
      .set('Authorization', `Bearer ${cedenteToken}`)
      .send({ sacado: `Sacado Dem ${unique()} Ltda`, cnpj: '55.444.333/0001-22', valor, vencimento: vencimentoFuturo(60), seguro: false, nfAnexada: true, comprovanteEntregaAnexado: true, pedidoCompraAnexado: true, batchValores: [] });
    if (res.status === 200) {
      setAceiteStatus(getAceiteByDuplicata(res.body.duplicataId)!.id, 'aceita');
      garantirLeilao(res.body.duplicataId);
      return res.body.duplicataId as string;
    }
  }
  throw new Error('emissão falhou');
}

describe('o demonstrativo da tela é o que a liquidação credita', () => {
  it('leilão: a empresa recebe no extrato exatamente o "Empresa recebe" que viu, e o aviso diz o líquido', async () => {
    const cedente = await registrar('cedente');
    const investidor = await registrar('investidor');
    const id = await emitir(cedente.token);

    // Antes de qualquer lance: o demonstrativo é na reserva do cedente.
    const antes = await request(app).get('/api/market').set('Authorization', `Bearer ${investidor.token}`).query({ pageSize: 100, q: getDuplicata(id)!.sacado_nome.toLowerCase() });
    expect(antes.body.offers[0].demonstrativo.referencia).toMatch(/^reserva do cedente/);

    expect((await darLance(investidor.token, id, 1.5)).status).toBe(200);

    const oferta = (await request(app).get('/api/market').set('Authorization', `Bearer ${investidor.token}`).query({ pageSize: 100, q: getDuplicata(id)!.sacado_nome.toLowerCase() })).body.offers[0];
    expect(oferta.demonstrativo.referencia).toBe('melhor lance (1,50% a.m.)');

    const minhas = await request(app).get('/api/minhas').set('Authorization', `Bearer ${cedente.token}`);
    const minha = minhas.body.duplicatas.find((x: { id: string }) => x.id === id);
    const dem = minha.leilao.demonstrativo;
    expect(dem).toEqual(oferta.demonstrativo);

    fecharLeiloes(id);
    const credito = listLedger(cedente.userId).find((l) => l.descricao.includes(id))!;
    expect(credito.valor).toBeCloseTo(dem.vendedorRecebe, 6);
    const debito = listLedger(investidor.userId).find((l) => l.descricao.includes(id))!;
    expect(-debito.valor).toBeCloseTo(dem.compradorPaga, 6);

    const aviso = listNotifications(cedente.userId).find((n) => n.text.includes('arrematado'))!;
    const recebeFmt = dem.linhas.find((l: { rotulo: string }) => l.rotulo === 'Empresa recebe').valorFmt;
    expect(aviso.text).toContain(`${recebeFmt} creditados`);
  });

  it('secundário: vendedor recebe o que a simulação e o anúncio mostraram', async () => {
    const cedente = await registrar('cedente');
    const vendedor = await registrar('investidor');
    const comprador = await registrar('investidor');
    const id = await emitir(cedente.token);
    expect((await darLance(vendedor.token, id)).status).toBe(200);
    fecharLeiloes(id);

    const sec = await request(app).get('/api/secundario').set('Authorization', `Bearer ${vendedor.token}`);
    const posicao = sec.body.minhasPosicoes.find((p: { duplicataId: string }) => p.duplicataId === id);

    const sim = await request(app).get('/api/secundario/simulacao').set('Authorization', `Bearer ${vendedor.token}`).query({ purchaseId: posicao.purchaseId, preco: '9.900' });
    expect(sim.status).toBe(200);
    expect(sim.body).toMatchObject({ valorFace: 10000, compradorPaga: 9900 });

    // Outro investidor não simula a posição de ninguém.
    const alheia = await request(app).get('/api/secundario/simulacao').set('Authorization', `Bearer ${comprador.token}`).query({ purchaseId: posicao.purchaseId, preco: '9.900' });
    expect(alheia.status).toBe(404);
    const invalida = await request(app).get('/api/secundario/simulacao').set('Authorization', `Bearer ${vendedor.token}`).query({ purchaseId: posicao.purchaseId, preco: 'abc' });
    expect(invalida.status).toBe(400);

    const listado = await request(app).post('/api/secundario/listar').set('Authorization', `Bearer ${vendedor.token}`).send({ purchaseId: posicao.purchaseId, askingValor: '9.900' });
    const anuncio = listado.body.market.find((l: { duplicataId: string }) => l.duplicataId === id);
    expect(anuncio.demonstrativo).toEqual(sim.body);

    expect((await request(app).post(`/api/secundario/${anuncio.id}/comprar`).set('Authorization', `Bearer ${comprador.token}`)).status).toBe(200);
    const credito = listLedger(vendedor.userId).find((l) => l.descricao.startsWith('Venda no mercado secundário') && l.descricao.includes(id))!;
    expect(credito.valor).toBeCloseTo(sim.body.vendedorRecebe, 6);
  });
});

describe('GET /market/:id/simulacao', () => {
  it('simula a taxa digitada com o mesmo preço que o lance fixaria agora', async () => {
    const cedente = await registrar('cedente');
    const investidor = await registrar('investidor');
    const id = await emitir(cedente.token);

    const sim = await request(app).get(`/api/market/${id}/simulacao`).set('Authorization', `Bearer ${investidor.token}`).query({ taxaAm: '2,5' });
    expect(sim.status).toBe(200);
    expect(sim.body.compradorPaga).toBeCloseTo(computePurchasePrice(getDuplicata(id)!, 2.5).precoCompra, 6);
    expect(sim.body.linhas.map((l: { rotulo: string }) => l.rotulo)).toContain('Empresa recebe');

    expect((await request(app).get(`/api/market/${id}/simulacao`).set('Authorization', `Bearer ${investidor.token}`).query({ taxaAm: 'x' })).status).toBe(400);
    expect((await request(app).get(`/api/market/${id}/simulacao`).set('Authorization', `Bearer ${investidor.token}`).query({ taxaAm: '0' })).status).toBe(400);
    expect((await request(app).get('/api/market/NAO-EXISTE/simulacao').set('Authorization', `Bearer ${investidor.token}`).query({ taxaAm: '2' })).status).toBe(404);
  });
});
