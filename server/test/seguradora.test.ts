import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { db } from '../src/db/index.js';

beforeAll(async () => {
  await seedIfEmpty();
});

async function loginSeguradora() {
  const res = await request(app).post('/api/auth/login').send({ email: 'seguradora@lastro.demo', password: 'demo1234' });
  return res.body.token as string;
}

function unique(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function register(role: 'cedente' | 'sacado' | 'investidor', companyName: string) {
  const email = `${unique(role)}@example.com`;
  const res = await request(app).post('/api/auth/register').send({ nome: 'Teste', email, password: 'senha123', companyName, role });
  return { token: res.body.token as string, userId: res.body.user.id as number };
}

async function emitirComRetry(token: string, body: Record<string, unknown>) {
  let res = await request(app).post('/api/emitir/submit').set('Authorization', `Bearer ${token}`).send(body);
  for (let attempt = 0; attempt < 5 && res.status !== 200; attempt++) {
    res = await request(app).post('/api/emitir/submit').set('Authorization', `Bearer ${token}`).send(body);
  }
  return res;
}

describe('seguradora role', () => {
  it('is forbidden for non-seguradora roles', async () => {
    const login = await request(app).post('/api/auth/login').send({ email: 'investidor@lastro.demo', password: 'demo1234' });
    const res = await request(app).get('/api/seguradora').set('Authorization', `Bearer ${login.body.token}`);
    expect(res.status).toBe(403);
  });

  it('requires selecting an insurer when registering as seguradora', async () => {
    const email = `seg-${Date.now()}@example.com`;
    const res = await request(app)
      .post('/api/auth/register')
      .send({ nome: 'Nova Seguradora', email, password: 'senha123', companyName: 'Nova Seguros', role: 'seguradora' });
    expect(res.status).toBe(400);
  });

  it('shows the demo seguradora dashboard with seeded policies and an open sinistro', async () => {
    const token = await loginSeguradora();
    const res = await request(app).get('/api/seguradora').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.insurerName).toBe('Too Seguros');
    expect(res.body.totalApolices).toBeGreaterThan(0);
    expect(res.body.sinistros.length).toBeGreaterThan(0);
  });

  it('lets the seguradora approve a sinistro, notifying the cedente', async () => {
    const token = await loginSeguradora();
    const before = await request(app).get('/api/seguradora').set('Authorization', `Bearer ${token}`);
    const sinistro = before.body.sinistros[0];
    expect(sinistro).toBeTruthy();

    const res = await request(app)
      .post(`/api/seguradora/sinistro/${sinistro.id}/decidir`)
      .set('Authorization', `Bearer ${token}`)
      .send({ decision: 'aprovado', note: 'Documentação conferida, indenização aprovada.' });
    expect(res.status).toBe(200);
    expect(res.body.sinistros.some((s: { id: string }) => s.id === sinistro.id)).toBe(false);

    const apolice = res.body.apolices.find((a: { id: string }) => a.id === sinistro.id);
    expect(apolice.sinistroStatus).toBe('aprovado');

    // deciding the same sinistro again should 404 (already decided)
    const again = await request(app)
      .post(`/api/seguradora/sinistro/${sinistro.id}/decidir`)
      .set('Authorization', `Bearer ${token}`)
      .send({ decision: 'negado', note: 'tentativa duplicada' });
    expect(again.status).toBe(404);
  });

  it('aprovar um sinistro credita o cedente pelo valor de face e debita a seguradora — antes só dizia "indenizará" e nunca movia dinheiro', async () => {
    const sacadoCompany = unique('Sacado Sinistro');
    const { token: sacadoToken } = await register('sacado', sacadoCompany);
    const { token: cedenteToken } = await register('cedente', unique('Cedente Sinistro'));
    const { token: investidorToken } = await register('investidor', unique('Investidor Segura'));

    const emit = await emitirComRetry(cedenteToken, {
      sacado: sacadoCompany,
      cnpj: '33.222.111/0001-77',
      valor: '20.000',
      vencimento: '2026-09-10', // ainda no futuro no momento da contratação do seguro
      seguro: false,
      nfAnexada: true,
      batchValores: [],
    });
    expect(emit.status).toBe(200);
    const duplicataId = emit.body.duplicataId as string;
    // Nunca disparada pro leilão — segue 'aprovada', igual ao caminho real que
    // listClaimableByInsurerKey cobre ("o cedente nunca foi pago pelo mercado").

    const insure = await request(app).post(`/api/market/${duplicataId}/insure`).set('Authorization', `Bearer ${investidorToken}`).send({ key: 'too' });
    expect(insure.status).toBe(200);

    // Simula o tempo passando depois da apólice já contratada — não dá pra segurar uma
    // duplicata que já venceu (ver teste de underwriting abaixo), então o vencimento só
    // vira passado depois que o seguro já estava em vigor, como seria no mundo real.
    db.prepare('UPDATE duplicatas SET vencimento = ? WHERE id = ?').run('2020-01-10', duplicataId);

    const seguradoraToken = await loginSeguradora();
    const before = await request(app).get('/api/seguradora').set('Authorization', `Bearer ${seguradoraToken}`);
    const sinistro = before.body.sinistros.find((s: { id: string }) => s.id === duplicataId);
    expect(sinistro).toBeTruthy();

    const recover = await request(app)
      .post(`/api/seguradora/sinistro/${duplicataId}/decidir`)
      .set('Authorization', `Bearer ${seguradoraToken}`)
      .send({ decision: 'aprovado', note: 'Documentação conferida, indenização aprovada.' });
    expect(recover.status).toBe(200);

    const cedenteExtrato = await request(app).get('/api/account').set('Authorization', `Bearer ${cedenteToken}`);
    const credit = cedenteExtrato.body.extrato.find((e: { descricao: string }) => e.descricao.includes(duplicataId) && e.descricao.includes('Indenização'));
    expect(credit).toBeTruthy();
    expect(credit.isPositive).toBe(true);
    expect(credit.valorFmt.replace(/\D/g, '')).toBe('20000');

    const seguradoraExtrato = await request(app).get('/api/account').set('Authorization', `Bearer ${seguradoraToken}`);
    const debit = seguradoraExtrato.body.extrato.find((e: { descricao: string }) => e.descricao.includes(duplicataId) && e.descricao.includes('Indenização'));
    expect(debit).toBeTruthy();
    expect(debit.isPositive).toBe(false);
    expect(debit.valorFmt.replace(/\D/g, '')).toBe('20000');

    // Marcada 'paga' — não pode também virar candidata a cobrança jurídica e ser
    // "recuperada" uma segunda vez pelo mesmo valor.
    const minhas = await request(app).get('/api/minhas').set('Authorization', `Bearer ${cedenteToken}`);
    const dup = minhas.body.duplicatas.find((d: { id: string }) => d.id === duplicataId);
    expect(dup.status).toBe('Paga');
  });

  it('negar um sinistro não move dinheiro nenhum', async () => {
    const sacadoCompany = unique('Sacado Sinistro Negado');
    const { token: sacadoToken } = await register('sacado', sacadoCompany);
    const { token: cedenteToken } = await register('cedente', unique('Cedente Sinistro Negado'));
    const { token: investidorToken } = await register('investidor', unique('Investidor Segura Negado'));

    const emit = await emitirComRetry(cedenteToken, {
      sacado: sacadoCompany,
      cnpj: '33.222.111/0001-77',
      valor: '15.000',
      vencimento: '2026-09-10',
      seguro: false,
      nfAnexada: true,
      batchValores: [],
    });
    const duplicataId = emit.body.duplicataId as string;
    await request(app).post(`/api/market/${duplicataId}/insure`).set('Authorization', `Bearer ${investidorToken}`).send({ key: 'too' });
    db.prepare('UPDATE duplicatas SET vencimento = ? WHERE id = ?').run('2020-01-10', duplicataId);

    const seguradoraToken = await loginSeguradora();
    const before = await request(app).get('/api/account').set('Authorization', `Bearer ${cedenteToken}`);
    const countBefore = before.body.extrato.length;

    const decide = await request(app)
      .post(`/api/seguradora/sinistro/${duplicataId}/decidir`)
      .set('Authorization', `Bearer ${seguradoraToken}`)
      .send({ decision: 'negado', note: 'Sinistro não caracterizado.' });
    expect(decide.status).toBe(200);

    const after = await request(app).get('/api/account').set('Authorization', `Bearer ${cedenteToken}`);
    expect(after.body.extrato.length).toBe(countBefore);
  });

  it('não deixa contratar seguro numa duplicata que já venceu — o risco já se realizou, não é mais underwriting', async () => {
    const sacadoCompany = unique('Sacado Ja Vencida');
    const { token: sacadoToken } = await register('sacado', sacadoCompany);
    const { token: cedenteToken } = await register('cedente', unique('Cedente Ja Vencida'));
    const { token: investidorToken } = await register('investidor', unique('Investidor Ja Vencida'));

    const emit = await emitirComRetry(cedenteToken, {
      sacado: sacadoCompany,
      cnpj: '33.222.111/0001-77',
      valor: '10.000',
      vencimento: '2020-01-10', // já vencida antes mesmo de tentar segurar
      seguro: false,
      nfAnexada: true,
      batchValores: [],
    });
    expect(emit.status).toBe(200);
    const duplicataId = emit.body.duplicataId as string;

    const insure = await request(app).post(`/api/market/${duplicataId}/insure`).set('Authorization', `Bearer ${investidorToken}`).send({ key: 'too' });
    expect(insure.status).toBe(409);
    expect(insure.body.error).toBe('already_overdue');

    // Sem apólice nenhuma, não pode ter virado sinistro reclamável.
    const seguradoraToken = await loginSeguradora();
    const dashboard = await request(app).get('/api/seguradora').set('Authorization', `Bearer ${seguradoraToken}`);
    expect(dashboard.body.sinistros.some((s: { id: string }) => s.id === duplicataId)).toBe(false);
  });
});
