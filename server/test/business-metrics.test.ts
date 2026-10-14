import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { db } from '../src/db/index.js';
import { createDuplicata, dispararLeilao } from '../src/db/duplicatas.js';
import { ensureAceite, setAceiteStatus } from '../src/db/aceites.js';
import { reserveRate } from '../src/lib/auctionCore.js';
import { computeIndicadoresNegocio } from '../src/lib/businessMetrics.js';
import { fecharLeiloes } from './helpers/auction.js';
import { credenciarInvestidor } from './helpers/investidor.js';
import { vencimentoFuturo } from './helpers/datas.js';

// Os indicadores do plano de ação saem do fluxo real (lance → fechamento → liquidação), não
// de contadores próprios. Cada teste mede a DIFERENÇA antes/depois no mês corrente, porque o
// seed e os outros testes do arquivo também movimentam o marketplace.

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function registrar(role: 'investidor' | 'cedente') {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Teste', email: `${role}-${unique()}@example.com`, password: 'senha123', companyName: `${role} ${unique()}`, role });
  if (role === 'investidor') credenciarInvestidor(res.body.user.id);
  return { token: res.body.token as string, userId: res.body.user.id as number };
}

function duplicataEmLeilao(cedenteId: number | null, valor: number) {
  const d = createDuplicata({
    cedenteId,
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

function lance(token: string, duplicataId: string, taxaAm: number) {
  return request(app).post(`/api/market/${duplicataId}/lance`).set('Authorization', `Bearer ${token}`).send({ taxaAm });
}

const mesAtual = () => computeIndicadoresNegocio().meses.at(-1)!;

describe('indicadores de negócio do back-office', () => {
  it('um leilão arrematado soma volume, operação, cedente, compradores, receita e entra no deságio médio', async () => {
    const antes = mesAtual();
    const cedente = await registrar('cedente');
    const vencedor = await registrar('investidor');
    const perdedor = await registrar('investidor');
    const id = duplicataEmLeilao(cedente.userId, 50_000);
    const reserva = reserveRate(id)!.taxaAm;

    expect((await lance(perdedor.token, id, reserva)).status).toBe(200);
    expect((await lance(vencedor.token, id, reserva - 0.5)).status).toBe(200);
    expect(fecharLeiloes(id)).toMatchObject({ vendidos: 1 });

    const depois = mesAtual();
    expect(depois.volume - antes.volume).toBe(50_000);
    expect(depois.operacoes - antes.operacoes).toBe(1);
    expect(depois.cedentesAtivos - antes.cedentesAtivos).toBe(1);
    expect(depois.compradoresAtivos - antes.compradoresAtivos).toBe(2);
    expect(depois.leiloesComLance - antes.leiloesComLance).toBe(1);
    expect(depois.receita).toBeGreaterThan(antes.receita);
    expect(depois.desagioMedioAm).not.toBeNull();
    expect(depois.prazoMedioDias).toBeGreaterThan(0);
  });

  it('um leilão que fecha sem lance conta como encerrado, mas não como arrematado nem como volume', async () => {
    const antes = mesAtual();
    const id = duplicataEmLeilao(null, 20_000);
    expect(fecharLeiloes(id)).toMatchObject({ semLance: 1 });

    const depois = mesAtual();
    expect(depois.leiloesEncerrados - antes.leiloesEncerrados).toBe(1);
    expect(depois.leiloesComLance).toBe(antes.leiloesComLance);
    expect(depois.volume).toBe(antes.volume);
    expect(depois.pctLeiloesComLance).not.toBeNull();
  });

  it('operação de sandbox não entra em nenhum número', async () => {
    const antes = mesAtual();
    const inv = await registrar('investidor');
    const id = duplicataEmLeilao(null, 70_000);
    db.prepare('UPDATE duplicatas SET sandbox = 1 WHERE id = ?').run(id);
    db.prepare("INSERT INTO purchases (duplicata_id, investor_id, valor, taxa, retorno) VALUES (?, ?, 70000, '3,00', 1000)").run(id, inv.userId);

    const depois = mesAtual();
    expect(depois.volume).toBe(antes.volume);
    expect(depois.operacoes).toBe(antes.operacoes);
  });

  it('uma revenda da mesma duplicata não conta como volume novo', async () => {
    const inv = await registrar('investidor');
    const id = duplicataEmLeilao(null, 30_000);
    expect((await lance(inv.token, id, reserveRate(id)!.taxaAm)).status).toBe(200);
    fecharLeiloes(id);
    const antes = mesAtual();

    const outro = await registrar('investidor');
    db.prepare("INSERT INTO purchases (duplicata_id, investor_id, valor, taxa, retorno) VALUES (?, ?, 29000, '2,50', 500)").run(id, outro.userId);
    expect(mesAtual().volume).toBe(antes.volume);
  });

  it('carteira vencida: duplicata vendida e não paga depois do vencimento entra no valor vencido', () => {
    const antes = computeIndicadoresNegocio().carteira;
    const id = duplicataEmLeilao(null, 15_000);
    db.prepare("UPDATE duplicatas SET status = 'vendida', vencimento = '2020-01-10' WHERE id = ?").run(id);

    const depois = computeIndicadoresNegocio().carteira;
    expect(depois.vencidoValor - antes.vencidoValor).toBe(15_000);
    expect(depois.pctVencido).not.toBeNull();
  });

  it('lista os 6 últimos meses, do mais antigo ao atual, com rótulo em português', () => {
    const { meses, naoMedidos } = computeIndicadoresNegocio(new Date('2026-10-15T12:00:00Z'));
    expect(meses.map((m) => m.mes)).toEqual(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
    expect(meses.at(-1)!.mesLabel).toBe('out/2026');
    expect(naoMedidos.length).toBeGreaterThan(0);
  });

  it('GET /admin/indicadores é só do admin', async () => {
    const admin = await request(app).post('/api/auth/login').send({ email: 'admin@lastro.demo', password: 'demo1234' });
    const ok = await request(app).get('/api/admin/indicadores').set('Authorization', `Bearer ${admin.body.token}`);
    expect(ok.status).toBe(200);
    expect(ok.body.meses).toHaveLength(6);

    const cedente = await registrar('cedente');
    const negado = await request(app).get('/api/admin/indicadores').set('Authorization', `Bearer ${cedente.token}`);
    expect(negado.status).toBe(403);
  });
});
