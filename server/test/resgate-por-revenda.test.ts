import { describe, expect, it, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { app } from '../src/app.js';
import { db } from '../src/db/index.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { createDuplicata } from '../src/db/duplicatas.js';
import { buildDarfSummary } from '../src/lib/darfGenerator.js';
import { buildIncomeTaxStatement } from '../src/lib/incomeTaxStatement.js';
import { buildPerformanceDashboard } from '../src/lib/investorPerformance.js';
import { credenciarInvestidor } from './helpers/investidor.js';

// Quando o rendimento aconteceu: no vencimento da duplicata ou, para quem revendeu antes, na
// data da revenda (purchases.encerrada_em, migração 0081). DARF, Informe e performance usavam
// o vencimento para todo mundo — e o Informe ainda separava o ano pela data da COMPRA.

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function investidor() {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Fundo', email: `resg-${unique()}@example.com`, password: 'senha123', companyName: `Fundo ${unique()}`, role: 'investidor' });
  credenciarInvestidor(res.body.user.id);
  return res.body.user.id as number;
}

function duplicata(vencimento: string, status = 'vendida') {
  return createDuplicata({
    cedenteId: null,
    cedenteNome: 'Cedente Resgate',
    sacadoNome: `Sacado ${unique()}`,
    sacadoCnpj: '',
    valor: 10000,
    vencimento,
    emissao: '01/03/2025',
    status,
    lastroPct: 100,
    seguro: false,
  }).id;
}

function posicao(duplicataId: string, investorId: number, o: { valor: number; retorno: number; criada: string; ativa: boolean; encerrada?: string | null }) {
  const info = db
    .prepare('INSERT INTO purchases (duplicata_id, investor_id, valor, taxa, retorno, active, created_at, encerrada_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(duplicataId, investorId, o.valor, '2,0%', o.retorno, o.ativa ? 1 : 0, o.criada, o.encerrada ?? null);
  return Number(info.lastInsertRowid);
}

/** Comprou em 01/03/2025, revendeu em 15/05/2025; o comprador segura até o vencimento, 30/09/2025. */
async function cenarioRevenda() {
  const vendedor = await investidor();
  const comprador = await investidor();
  const dup = duplicata('2025-09-30');
  posicao(dup, vendedor, { valor: 9500, retorno: 300, criada: '2025-03-01 10:00:00', ativa: false, encerrada: '2025-05-15 12:00:00' });
  posicao(dup, comprador, { valor: 9800, retorno: 200, criada: '2025-05-15 12:00:00', ativa: true });
  return { vendedor, comprador, dup };
}

describe('DARF', () => {
  it('a posição revendida entra no mês da revenda, com alíquota pelo prazo até a revenda', async () => {
    const { dup } = await cenarioRevenda();

    const maio = buildDarfSummary('2025-05').lines.filter((l) => l.duplicataId === dup);
    expect(maio).toHaveLength(1);
    expect(maio[0]).toMatchObject({ evento: 'revenda', vencimento: '15/05/2025', aliquotaLabel: expect.stringContaining('22,5%') });
    expect(maio[0].diasCarencia).toBe(75);

    // O comprador continua tributado no vencimento; o vendedor não aparece de novo em setembro.
    const setembro = buildDarfSummary('2025-09').lines.filter((l) => l.duplicataId === dup);
    expect(setembro).toHaveLength(1);
    expect(setembro[0].evento).toBe('vencimento');
  });
});

describe('Informe de Rendimentos', () => {
  it('a revenda aparece com a data da revenda', async () => {
    const { vendedor } = await cenarioRevenda();
    const informe = buildIncomeTaxStatement(vendedor, 'Fundo', 2025);
    expect(informe.lines).toHaveLength(1);
    expect(informe.lines[0]).toMatchObject({ evento: 'revenda', dataResgate: '15/05/2025', diasCarencia: 75 });
  });

  it('o rendimento entra no ano em que foi recebido, não no ano da compra', async () => {
    const inv = await investidor();
    const dup = duplicata('2025-02-10');
    posicao(dup, inv, { valor: 9700, retorno: 300, criada: '2024-12-10 09:00:00', ativa: true });
    expect(buildIncomeTaxStatement(inv, 'Fundo', 2024).lines).toHaveLength(0);
    expect(buildIncomeTaxStatement(inv, 'Fundo', 2025).lines).toHaveLength(1);
  });

  it('posição que ainda não venceu não entra — o rendimento não aconteceu', async () => {
    const inv = await investidor();
    const futuro = new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10);
    posicao(duplicata(futuro, 'vendida'), inv, { valor: 9700, retorno: 300, criada: new Date().toISOString().slice(0, 19).replace('T', ' '), ativa: true });
    expect(buildIncomeTaxStatement(inv, 'Fundo', new Date(futuro).getUTCFullYear()).lines).toHaveLength(0);
  });
});

describe('performance', () => {
  it('quem revendeu não carrega o atraso da duplicata, e o prazo da posição vai até a revenda', async () => {
    const vendedor = await investidor();
    const comprador = await investidor();
    // Venceu há muito e não foi paga — inadimplência de mais de 90 dias para quem a detém.
    const dup = duplicata('2025-01-15');
    posicao(dup, vendedor, { valor: 9500, retorno: 300, criada: '2024-11-01 10:00:00', ativa: false, encerrada: '2024-12-01 10:00:00' });
    posicao(dup, comprador, { valor: 9800, retorno: 200, criada: '2024-12-01 10:00:00', ativa: true });

    const pv = buildPerformanceDashboard(vendedor);
    expect(pv.saude.inadimplencia90Valor).toBe(0);
    expect(pv.positions[0].diasCarencia).toBe(30);

    expect(buildPerformanceDashboard(comprador).saude.inadimplencia90Valor).toBe(9800);
  });
});

describe('migração 0081', () => {
  it('preenche encerrada_em das posições revendidas com a data da compra seguinte', async () => {
    const a = await investidor();
    const b = await investidor();
    const dup = duplicata('2025-12-01');
    const antiga = posicao(dup, a, { valor: 9500, retorno: 100, criada: '2025-06-01 10:00:00', ativa: false });
    const nova = posicao(dup, b, { valor: 9700, retorno: 300, criada: '2025-07-20 15:30:00', ativa: true });

    const sql = fs.readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'db', 'migrations', '0081_purchases_encerrada_em.sql'),
      'utf8'
    );
    // Só o UPDATE: a coluna já existe neste banco de teste.
    db.exec(sql.slice(sql.indexOf('UPDATE purchases')));

    const encerrada = (id: number) => (db.prepare('SELECT encerrada_em FROM purchases WHERE id = ?').get(id) as { encerrada_em: string | null }).encerrada_em;
    expect(encerrada(antiga)).toBe('2025-07-20 15:30:00');
    expect(encerrada(nova)).toBeNull();
  });
});
