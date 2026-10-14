import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { getDuplicata } from '../src/db/duplicatas.js';
import { getAceiteByDuplicata } from '../src/db/aceites.js';
import { listNotifications } from '../src/db/misc.js';
import { listAuditLog } from '../src/db/audit.js';
import { getDisputeByAceite } from '../src/db/disputes.js';
import { vencimentoFuturo } from './helpers/datas.js';

// Etapa 1 de "facilitar a vida da empresa":
// (a) uma duplicata emitida sem todos os documentos ficava 'pendente_analise' para sempre —
//     agora a empresa completa depois e ela é liberada para leilão;
// (b) o sacado sem conta nunca era avisado — agora recebe um link e responde sem conta.

beforeAll(async () => {
  await seedIfEmpty();
});

const MINIMAL_PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
const CNPJ_SACADO = '11.222.333/0001-81';
const OUTRO_CNPJ = '11.444.777/0001-61';

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function cedente() {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Empresa', email: `dest-${unique()}@example.com`, password: 'senha123', companyName: `Metalúrgica ${unique()} Ltda`, role: 'cedente' });
  return { token: res.body.token as string, userId: res.body.user.id as number };
}

/** Emite como a planilha/ERP emitem: sem CNPJ do sacado e sem nenhum anexo. */
async function emitirIncompleta(token: string, extra: Record<string, unknown> = {}) {
  // A registradora simulada falha de propósito de vez em quando (502), como os outros testes de emissão já tratam.
  let res: request.Response | null = null;
  for (let i = 0; i < 8; i++) {
    res = await request(app)
      .post('/api/emitir/submit')
      .set('Authorization', `Bearer ${token}`)
      .send({ sacado: `Supermercado ${unique()} Ltda`, cnpj: '', valor: '20.000', vencimento: vencimentoFuturo(60), seguro: false, batchValores: [], ...extra });
    if (res.status !== 502) break;
  }
  expect(res!.status).toBe(200);
  return res!.body as { duplicataId: string; convite: { link: string; whatsappUrl: string; email: { status: string } | null } | null };
}

function anexar(token: string, duplicataId: string, kind: string) {
  return request(app)
    .post('/api/uploads')
    .set('Authorization', `Bearer ${token}`)
    .field('kind', kind)
    .field('duplicataId', duplicataId)
    .attach('file', MINIMAL_PDF, { filename: `${kind}.pdf`, contentType: 'application/pdf' });
}

async function faltando(token: string, id: string) {
  const res = await request(app).get('/api/minhas').set('Authorization', `Bearer ${token}`);
  return res.body.duplicatas.find((d: { id: string }) => d.id === id).faltando as { key: string; acao: unknown }[];
}

describe('completar o lastro depois da emissão', () => {
  it('duplicata incompleta mostra o que falta, e anexando tudo é liberada para leilão', async () => {
    const c = await cedente();
    const { duplicataId: id } = await emitirIncompleta(c.token);
    expect(getDuplicata(id)!.status).toBe('pendente_analise');
    expect(getDuplicata(id)!.lastro_pct).toBe(33);

    expect((await faltando(c.token, id)).map((f) => f.key)).toEqual(['sacado_cnpj', 'nota_fiscal', 'comprovante_entrega', 'pedido_compra']);

    expect((await anexar(c.token, id, 'nfe')).status).toBe(201);
    expect((await anexar(c.token, id, 'comprovante_entrega')).status).toBe(201);
    const ultimo = await anexar(c.token, id, 'pedido_compra');
    expect(ultimo.body.lastro).toMatchObject({ liberada: false });
    expect(getDuplicata(id)!.lastro_pct).toBe(83);
    expect((await faltando(c.token, id)).map((f) => f.key)).toEqual(['sacado_cnpj']);

    // CNPJ inválido é recusado; o válido completa e libera.
    const ruim = await request(app).post(`/api/minhas/${id}/sacado-cnpj`).set('Authorization', `Bearer ${c.token}`).send({ cnpj: '11.111.111/1111-11' });
    expect(ruim.status).toBe(400);
    const bom = await request(app).post(`/api/minhas/${id}/sacado-cnpj`).set('Authorization', `Bearer ${c.token}`).send({ cnpj: CNPJ_SACADO });
    expect(bom.status).toBe(200);
    expect(bom.body.liberada).toBe(true);
    expect(getDuplicata(id)!).toMatchObject({ status: 'aprovada', lastro_pct: 100 });
    expect(listNotifications(c.userId).some((n) => n.text.includes('Documentos completos'))).toBe(true);
    expect(await faltando(c.token, id)).toEqual([]);
  });

  it('outra empresa não consegue mexer na duplicata', async () => {
    const dono = await cedente();
    const outra = await cedente();
    const { duplicataId: id } = await emitirIncompleta(dono.token);
    expect((await anexar(outra.token, id, 'comprovante_entrega')).status).toBe(404);
    expect((await request(app).post(`/api/minhas/${id}/sacado-cnpj`).set('Authorization', `Bearer ${outra.token}`).send({ cnpj: CNPJ_SACADO })).status).toBe(404);
  });

  it('um documento qualquer (instrumento de cessão) não conta como item do lastro', async () => {
    const c = await cedente();
    const { duplicataId: id } = await emitirIncompleta(c.token);
    const res = await anexar(c.token, id, 'contrato_cessao');
    expect(res.status).toBe(201);
    expect(res.body.lastro).toBeNull();
    expect(getDuplicata(id)!.lastro_pct).toBe(33);
  });
});

async function aceiteId(token: string, duplicataId: string) {
  const res = await request(app).get('/api/aceites').set('Authorization', `Bearer ${token}`);
  return res.body.aceites.find((a: { duplicataId: string }) => a.duplicataId === duplicataId) as { id: number; podeConvidar: boolean; convite: unknown };
}

const tokenDo = (link: string) => link.split('/aceite/')[1];

describe('aceite do sacado por link', () => {
  it('a empresa convida, o sacado confere e confirma sem conta — uma vez só', async () => {
    const c = await cedente();
    const { duplicataId: id } = await emitirIncompleta(c.token, { cnpj: CNPJ_SACADO });
    const a = await aceiteId(c.token, id);
    expect(a.podeConvidar).toBe(true);
    expect(a.convite).toBeNull();

    const conv = await request(app).post(`/api/aceites/${a.id}/convite`).set('Authorization', `Bearer ${c.token}`).send({ email: 'financeiro@sacado.com.br', telefone: '(11) 98888-7777' });
    expect(conv.status).toBe(200);
    // Sem SMTP/Twilio neste ambiente: diz que simulou, e entrega o atalho do WhatsApp.
    expect(conv.body.email).toEqual({ destino: 'financeiro@sacado.com.br', status: 'simulado' });
    expect(conv.body.whatsapp).toEqual({ destino: '11988887777', status: 'nao_configurado' });
    expect(conv.body.whatsappUrl).toMatch(/^https:\/\/wa\.me\/5511988887777\?text=/);
    expect((await aceiteId(c.token, id)).convite).toMatchObject({ email: 'financeiro@sacado.com.br', respondido: false });

    const token = tokenDo(conv.body.link);
    const ver = await request(app).get(`/api/public/aceite/${token}`);
    expect(ver.status).toBe(200);
    expect(ver.body).toMatchObject({ duplicataId: id, valorFmt: 'R$\u00a020.000', cnpjConhecido: true });

    const errado = await request(app).post(`/api/public/aceite/${token}`).send({ decisao: 'aceita', cnpj: OUTRO_CNPJ, nome: 'Ana Souza', cargo: 'Financeiro' });
    expect(errado.status).toBe(403);

    const ok = await request(app).post(`/api/public/aceite/${token}`).set('User-Agent', 'teste-navegador').send({ decisao: 'aceita', cnpj: CNPJ_SACADO, nome: 'Ana Souza', cargo: 'Financeiro' });
    expect(ok.status).toBe(200);
    expect(getAceiteByDuplicata(id)!.status).toBe('aceita');
    expect(listNotifications(c.userId).some((n) => n.text.includes('aceitou a duplicata'))).toBe(true);
    expect(listAuditLog(50).some((e) => e.action === 'aceite.aceita' && e.actor_label.includes('Ana Souza (Financeiro)') && e.actor_label.includes('via link'))).toBe(true);

    // Link usado não vale de novo.
    expect((await request(app).get(`/api/public/aceite/${token}`)).status).toBe(410);
    expect((await request(app).post(`/api/public/aceite/${token}`).send({ decisao: 'contestada', cnpj: CNPJ_SACADO, nome: 'Ana Souza', cargo: 'Financeiro', motivo: 'mudei de ideia' })).status).toBe(410);
  });

  it('contestar exige motivo, e o motivo vai para a disputa', async () => {
    const c = await cedente();
    const { duplicataId: id } = await emitirIncompleta(c.token, { cnpj: CNPJ_SACADO });
    const a = await aceiteId(c.token, id);
    const conv = await request(app).post(`/api/aceites/${a.id}/convite`).set('Authorization', `Bearer ${c.token}`).send({ email: 'x@sacado.com.br' });
    const token = tokenDo(conv.body.link);

    const semMotivo = await request(app).post(`/api/public/aceite/${token}`).send({ decisao: 'contestada', cnpj: CNPJ_SACADO, nome: 'Rui Lima', cargo: 'Compras' });
    expect(semMotivo.status).toBe(400);
    const res = await request(app).post(`/api/public/aceite/${token}`).send({ decisao: 'contestada', cnpj: CNPJ_SACADO, nome: 'Rui Lima', cargo: 'Compras', motivo: 'Mercadoria veio com defeito' });
    expect(res.status).toBe(200);
    expect(getDisputeByAceite(a.id)!.motivo).toContain('Mercadoria veio com defeito');
  });

  it('sem CNPJ na duplicata, o CNPJ informado pelo sacado passa a valer e completa esse item', async () => {
    const c = await cedente();
    const { duplicataId: id } = await emitirIncompleta(c.token);
    const a = await aceiteId(c.token, id);
    const conv = await request(app).post(`/api/aceites/${a.id}/convite`).set('Authorization', `Bearer ${c.token}`).send({ telefone: '11977776666' });
    const token = tokenDo(conv.body.link);
    expect((await request(app).get(`/api/public/aceite/${token}`)).body.cnpjConhecido).toBe(false);

    await request(app).post(`/api/public/aceite/${token}`).send({ decisao: 'aceita', cnpj: CNPJ_SACADO, nome: 'Ana Souza', cargo: 'Financeiro' }).expect(200);
    expect(getDuplicata(id)!.sacado_cnpj).toBe(CNPJ_SACADO);
    expect((await faltando(c.token, id)).map((f) => f.key)).not.toContain('sacado_cnpj');
  });

  it('a emissão já manda o convite quando a empresa informa o contato do sacado', async () => {
    const c = await cedente();
    const body = await emitirIncompleta(c.token, { cnpj: CNPJ_SACADO, sacadoEmail: 'contas@sacado.com.br' });
    expect(body.convite).toMatchObject({ email: { status: 'simulado' } });
    expect(body.convite!.link).toContain('/aceite/');
  });

  it('só a dona da duplicata convida; contato inválido e link inexistente são recusados', async () => {
    const dono = await cedente();
    const outra = await cedente();
    const { duplicataId: id } = await emitirIncompleta(dono.token, { cnpj: CNPJ_SACADO });
    const a = await aceiteId(dono.token, id);
    expect((await request(app).post(`/api/aceites/${a.id}/convite`).set('Authorization', `Bearer ${outra.token}`).send({ email: 'a@b.com' })).status).toBe(404);
    expect((await request(app).post(`/api/aceites/${a.id}/convite`).set('Authorization', `Bearer ${dono.token}`).send({})).status).toBe(400);
    expect((await request(app).post(`/api/aceites/${a.id}/convite`).set('Authorization', `Bearer ${dono.token}`).send({ email: 'nao-e-email' })).status).toBe(400);
    expect((await request(app).get('/api/public/aceite/token-que-nao-existe')).status).toBe(404);
  });
});
