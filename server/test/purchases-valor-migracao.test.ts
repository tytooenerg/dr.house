import { describe, expect, it, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { app } from '../src/app.js';
import { db } from '../src/db/index.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { createDuplicata, getDuplicata } from '../src/db/duplicatas.js';
import { addLedgerEntry } from '../src/db/misc.js';
import { buildResumoFiscalCedente } from '../src/lib/fiscalCedente.js';
import { arrematar } from './helpers/auction.js';
import { credenciarInvestidor } from './helpers/investidor.js';
import { vencimentoFuturo } from './helpers/datas.js';
import { getAceiteByDuplicata, setAceiteStatus } from '../src/db/aceites.js';

// purchases.valor = quanto o investidor PAGOU, em toda linha. A compra primária gravava o
// valor de face; a migração 0080 corrige as linhas antigas e lib/auctionClose.ts passou a
// gravar o preço pago.

beforeAll(async () => {
  await seedIfEmpty();
});

const MIGRACAO = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'db', 'migrations', '0080_purchases_valor_preco_pago.sql'),
  'utf8'
);

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function usuario(role: 'investidor' | 'cedente') {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Teste', email: `mig-${role}-${unique()}@example.com`, password: 'senha123', companyName: `Mig ${role} ${unique()} Ltda`, role });
  if (role === 'investidor') credenciarInvestidor(res.body.user.id);
  return { token: res.body.token as string, userId: res.body.user.id as number };
}

function duplicata(valor: number, cedenteId: number | null = null) {
  return createDuplicata({
    cedenteId,
    cedenteNome: 'Cedente Mig',
    sacadoNome: `Sacado ${unique()}`,
    sacadoCnpj: '',
    valor,
    vencimento: vencimentoFuturo(60),
    emissao: '10/10/2026',
    status: 'vendida',
    lastroPct: 100,
    seguro: false,
  }).id;
}

/** Linha de purchases como o código ANTIGO gravava. */
function compraAntiga(duplicataId: string, investorId: number, valor: number, retorno: number, active = 1) {
  const info = db
    .prepare('INSERT INTO purchases (duplicata_id, investor_id, valor, taxa, retorno, active) VALUES (?, ?, ?, ?, ?, ?)')
    .run(duplicataId, investorId, valor, '2,0%', retorno, active);
  return Number(info.lastInsertRowid);
}

const valorDe = (id: number) => (db.prepare('SELECT valor FROM purchases WHERE id = ?').get(id) as { valor: number }).valor;

describe('migração 0080 — compras primárias passam a guardar o preço pago', () => {
  it('corrige ativa (face − retorno), revendida (lance vencedor ou ledger) e não toca revenda nem quem não tem fonte', () => {
    const inv = db.prepare("SELECT id FROM users WHERE role = 'investidor' LIMIT 1").get() as { id: number };
    const outro = db.prepare("SELECT id FROM users WHERE role = 'investidor' ORDER BY id DESC LIMIT 1").get() as { id: number };

    // Ativa: face 10.000, deságio 300.
    const d1 = duplicata(10000);
    const ativa = compraAntiga(d1, inv.id, 10000, 300);

    // Revendida, com lance vencedor de R$ 19.400,40: retorno já sobrescrito pelo ganho da revenda.
    const d2 = duplicata(20000);
    const revendidaLance = compraAntiga(d2, inv.id, 20000, 150, 0);
    db.prepare("INSERT INTO auction_bids (duplicata_id, bidder_id, taxa_am, preco, status) VALUES (?, ?, 2, 19400.4, 'vencedor')").run(d2, inv.id);
    const revenda = compraAntiga(d2, outro.id, 19800, 200);

    // Revendida, sem lance (compra anterior ao leilão): o ledger diz quanto saiu da conta.
    const d3 = duplicata(5000);
    const revendidaLedger = compraAntiga(d3, inv.id, 5000, 90, 0);
    addLedgerEntry(inv.id, '01/09/2026', `Compra da duplicata ${d3} — Sacado X`, -4850);

    // Revendida e sem nenhuma fonte: fica como está.
    const d4 = duplicata(7000);
    const semFonte = compraAntiga(d4, inv.id, 7000, 10, 0);

    db.exec(MIGRACAO);

    expect(valorDe(ativa)).toBe(9700);
    expect(valorDe(revendidaLance)).toBe(20000 - Math.round(20000 - 19400.4));
    expect(valorDe(revenda)).toBe(19800);
    expect(valorDe(revendidaLedger)).toBe(4850);
    expect(valorDe(semFonte)).toBe(7000);

    // Rodar de novo não estraga nada (só toca linha que ainda guarda a face).
    db.exec(MIGRACAO);
    expect(valorDe(ativa)).toBe(9700);
  });
});

describe('o código novo grava o preço pago', () => {
  it('o arremate grava face − deságio em purchases.valor', async () => {
    const ced = await usuario('cedente');
    const inv = await usuario('investidor');
    let id = '';
    for (let i = 0; i < 8 && !id; i++) {
      const r = await request(app)
        .post('/api/emitir/submit')
        .set('Authorization', `Bearer ${ced.token}`)
        .send({ sacado: `Cliente ${unique()} Ltda`, cnpj: '11.222.333/0001-81', valor: '40.000', vencimento: vencimentoFuturo(60), seguro: false, nfAnexada: true, comprovanteEntregaAnexado: true, pedidoCompraAnexado: true, batchValores: [] });
      if (r.status === 200) id = r.body.duplicataId;
    }
    setAceiteStatus(getAceiteByDuplicata(id)!.id, 'aceita');
    expect((await arrematar(inv.token, id)).lance.status).toBe(200);

    const vencedor = db.prepare("SELECT preco FROM auction_bids WHERE duplicata_id = ? AND status = 'vencedor'").get(id) as { preco: number };
    const compra = db.prepare('SELECT valor, retorno FROM purchases WHERE duplicata_id = ?').get(id) as { valor: number; retorno: number };
    expect(compra.retorno).toBe(Math.round(40000 - vencedor.preco));
    expect(compra.valor).toBe(40000 - compra.retorno);
    expect(Math.abs(compra.valor - vencedor.preco)).toBeLessThanOrEqual(0.5);

    // O resumo fiscal do cedente usa só a compra primária; uma revenda depois não entra.
    const outro = await usuario('investidor');
    compraAntiga(id, outro.userId, 39500, 500);
    const resumo = buildResumoFiscalCedente(ced.userId, new Date().getFullYear());
    const linhas = resumo.linhas.filter((l) => l.duplicataId === id);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ valorFace: getDuplicata(id)!.valor, precoRecebido: compra.valor, despesaFinanceira: compra.retorno });
  });
});
