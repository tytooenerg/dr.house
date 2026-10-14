import { describe, expect, it, beforeAll, vi } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { getDuplicata } from '../src/db/duplicatas.js';
import { getAceiteByDuplicata } from '../src/db/aceites.js';
import { listLedger, listNotifications } from '../src/db/misc.js';
import { getUserById } from '../src/db/users.js';
import { applyAceiteDecision } from '../src/lib/aceiteCore.js';
import { MAX_RELANCAMENTOS } from '../src/lib/pilotoAutomatico.js';
import { darLance, fecharLeiloes } from './helpers/auction.js';
import { credenciarInvestidor } from './helpers/investidor.js';
import { vencimentoFuturo } from './helpers/datas.js';

// Etapa 3 de "facilitar a vida da empresa": o piloto automático abre o leilão quando o sacado
// confirma, relança leilão sem lance e manda o dinheiro para o Pix — tudo desligado por
// padrão e passando pelos mesmos caminhos (e travas) do clique.

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function cedente(piloto?: Record<string, unknown>) {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Piloto', email: `piloto-${unique()}@example.com`, password: 'senha123', companyName: `Fábrica ${unique()} Ltda`, role: 'cedente' });
  const token = res.body.token as string;
  if (piloto) {
    const r = await request(app)
      .post('/api/account/piloto-automatico')
      .set('Authorization', `Bearer ${token}`)
      .send({ leilaoAoAceitar: false, reservaAm: null, relancarSemLance: false, saqueAutomaticoPix: false, ...piloto });
    expect(r.status).toBe(200);
  }
  return { token, userId: res.body.user.id as number };
}

/** Emissão completa (100% de lastro): nasce 'aprovada', faltando só o aceite. */
async function emitirCompleta(token: string) {
  for (let i = 0; i < 8; i++) {
    const res = await request(app)
      .post('/api/emitir/submit')
      .set('Authorization', `Bearer ${token}`)
      .send({
        sacado: `Cliente ${unique()} Ltda`,
        cnpj: '11.222.333/0001-81',
        valor: '10.000',
        vencimento: vencimentoFuturo(60),
        seguro: false,
        nfAnexada: true,
        comprovanteEntregaAnexado: true,
        pedidoCompraAnexado: true,
        batchValores: [],
      });
    if (res.status === 200) {
      expect(getDuplicata(res.body.duplicataId)!.status).toBe('aprovada');
      return res.body.duplicataId as string;
    }
  }
  throw new Error('emissão falhou');
}

function aceitar(id: string) {
  const d = getDuplicata(id)!;
  applyAceiteDecision(getAceiteByDuplicata(id)!, d, 'aceita');
}

async function investidor() {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Fundo', email: `fundo-${unique()}@example.com`, password: 'senha123', companyName: `FIDC ${unique()}`, role: 'investidor' });
  credenciarInvestidor(res.body.user.id);
  return { token: res.body.token as string, userId: res.body.user.id as number };
}

describe('configuração do piloto automático', () => {
  it('vem desligado, só a empresa configura, e a taxa máxima é validada', async () => {
    const c = await cedente();
    const conta = await request(app).get('/api/account').set('Authorization', `Bearer ${c.token}`);
    expect(conta.body.pilotoAutomatico).toEqual({ leilaoAoAceitar: false, reservaAm: null, relancarSemLance: false, saqueAutomaticoPix: false });

    const ruim = await request(app)
      .post('/api/account/piloto-automatico')
      .set('Authorization', `Bearer ${c.token}`)
      .send({ leilaoAoAceitar: true, reservaAm: 99, relancarSemLance: false, saqueAutomaticoPix: false });
    expect(ruim.status).toBe(400);

    const inv = await investidor();
    const proibido = await request(app)
      .post('/api/account/piloto-automatico')
      .set('Authorization', `Bearer ${inv.token}`)
      .send({ leilaoAoAceitar: true, reservaAm: null, relancarSemLance: false, saqueAutomaticoPix: false });
    expect(proibido.status).toBe(403);
  });
});

describe('leilão automático quando o sacado confirma', () => {
  it('desligado: o aceite não abre leilão nenhum', async () => {
    const c = await cedente();
    const id = await emitirCompleta(c.token);
    aceitar(id);
    expect(getDuplicata(id)!.status).toBe('aprovada');
  });

  it('ligado: o aceite abre o leilão com a taxa máxima escolhida e avisa a empresa', async () => {
    const c = await cedente({ leilaoAoAceitar: true, reservaAm: 2.4 });
    const id = await emitirCompleta(c.token);
    aceitar(id);
    expect(getDuplicata(id)!).toMatchObject({ status: 'no_mercado', reserva_taxa_am: 2.4 });
    expect(listNotifications(c.userId).some((n) => n.text.startsWith('Piloto automático: leilão de'))).toBe(true);
  });
});

describe('relançar leilão sem lance', () => {
  it(`relança até ${MAX_RELANCAMENTOS} vezes e então devolve a decisão à empresa`, async () => {
    const c = await cedente({ leilaoAoAceitar: true, relancarSemLance: true });
    const id = await emitirCompleta(c.token);
    aceitar(id);
    for (let i = 1; i <= MAX_RELANCAMENTOS; i++) {
      fecharLeiloes(id);
      expect(getDuplicata(id)!).toMatchObject({ status: 'no_mercado', leilao_tentativas: i });
    }
    fecharLeiloes(id);
    expect(getDuplicata(id)!.status).toBe('aprovada');
    expect(listNotifications(c.userId).some((n) => n.text.includes('encerrou sem lances'))).toBe(true);
  });
});

describe('saque automático para o Pix', () => {
  it('depois do arremate, o líquido sai do saldo para a chave Pix da empresa', async () => {
    const c = await cedente({ leilaoAoAceitar: true, saqueAutomaticoPix: true });
    await request(app).post('/api/account/kyc/bank').set('Authorization', `Bearer ${c.token}`).send({ chave: 'financeiro@fabrica.com.br' }).expect(200);
    const id = await emitirCompleta(c.token);
    aceitar(id);
    const inv = await investidor();
    expect((await darLance(inv.token, id)).status).toBe(200);
    fecharLeiloes(id);

    const credito = listLedger(c.userId).find((l) => l.descricao.startsWith('Liquidação da duplicata') && l.descricao.includes(id))!;
    await vi.waitFor(() => {
      const saque = listLedger(c.userId).find((l) => l.descricao.startsWith('Saque automático'))!;
      expect(saque.valor).toBeCloseTo(-credito.valor, 6);
      expect(saque.descricao).toContain('(simulado)');
    });
    expect(listNotifications(c.userId).some((n) => n.text.includes('enviados para a sua chave Pix (simulado)'))).toBe(true);
  });

  it('sem chave Pix, não saca e avisa — o dinheiro fica no saldo', async () => {
    const c = await cedente({ leilaoAoAceitar: true, saqueAutomaticoPix: true });
    const id = await emitirCompleta(c.token);
    aceitar(id);
    const inv = await investidor();
    expect((await darLance(inv.token, id)).status).toBe(200);
    fecharLeiloes(id);
    await vi.waitFor(() => expect(listNotifications(getUserById(c.userId)!.id).some((n) => n.text.includes('Saque automático não feito: Cadastre uma chave Pix'))).toBe(true));
    expect(listLedger(c.userId).some((l) => l.descricao.startsWith('Saque automático'))).toBe(false);
  });
});
