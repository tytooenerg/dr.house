import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { getAceiteByDuplicata, setAceiteStatus } from '../src/db/aceites.js';

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function registerCedente(companyName: string) {
  const email = `ced-${unique()}@example.com`;
  const res = await request(app).post('/api/auth/register').send({
    nome: 'Cedente Teste',
    email,
    password: 'senha123',
    companyName,
    role: 'cedente',
  });
  return res.body.token as string;
}

async function adminToken() {
  const res = await request(app).post('/api/auth/login').send({ email: 'admin@lastro.demo', password: 'demo1234' });
  return res.body.token as string;
}

async function submitEmitir(token: string, overrides: Partial<{ sacado: string; cnpj: string; valor: string; vencimento: string }> = {}) {
  let lastStatus = 0;
  let body: Record<string, unknown> = {};
  // Retry past registradora's ~12% simulated instability, same pattern emitir.test.ts uses.
  for (let attempt = 0; attempt < 10; attempt++) {
    const res = await request(app)
      .post('/api/emitir/submit')
      .set('Authorization', `Bearer ${token}`)
      .send({
        sacado: overrides.sacado ?? 'Grupo Atlas Varejo',
        cnpj: overrides.cnpj ?? '12.345.678/0001-90',
        valor: overrides.valor ?? '10.000',
        vencimento: overrides.vencimento ?? '2026-11-01',
        seguro: false,
        nfAnexada: true,
        batchValores: [],
      });
    lastStatus = res.status;
    body = res.body;
    if (res.status === 200) break;
    expect(res.status).toBe(502);
  }
  expect(lastStatus).toBe(200);
  return body as { duplicataId: string; complianceSuspensa: boolean };
}

describe('Compliance AI Engine', () => {
  it('does not suspend a clean, first-time emission', async () => {
    const token = await registerCedente(`Fornecedora Idônea ${unique()} Ltda`);
    const result = await submitEmitir(token, { sacado: 'Grupo Atlas Varejo', cnpj: '12.345.678/0001-90', valor: '5.000', vencimento: '2026-12-01' });
    expect(result.complianceSuspensa).toBe(false);
  });

  it('suspends and routes to the admin queue when duplicidade + PLD flag + a low sacado rating combine past the threshold', async () => {
    const sacado = 'Construtora Vale Norte'; // rating C in the static risk dataset
    const cnpj = '34.567.890/0001-22';
    const valor = '77.000';
    const vencimento = '2026-12-15';

    // First cedente emits cleanly — establishes the duplicidade candidate.
    const cedenteLimpo = await registerCedente(`Fornecedor Limpo ${unique()} Ltda`);
    await submitEmitir(cedenteLimpo, { sacado, cnpj, valor, vencimento });

    // Second cedente has a PLD-flagged company name (matches the demo sanctions
    // watchlist — see compliance-hardening.test.ts) and emits the exact same
    // sacado/valor/vencimento, tripping duplicidade too.
    const cedenteFlagged = await registerCedente('Comercial Exemplo Sancionada Ltda');
    const kyb = await request(app).post('/api/auth/kyb').set('Authorization', `Bearer ${cedenteFlagged}`).send({ cnpj: '99.999.999/0001-88' });
    expect(kyb.status).toBe(200);
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${cedenteFlagged}`);
    expect(me.body.user.pldStatus).toBe('flagged');

    const result = await submitEmitir(cedenteFlagged, { sacado, cnpj, valor, vencimento });
    expect(result.complianceSuspensa).toBe(true);

    // Shows up in the admin back-office queue with a real score and breakdown.
    const admin = await adminToken();
    const queue = await request(app).get('/api/admin/compliance-queue').set('Authorization', `Bearer ${admin}`);
    expect(queue.status).toBe(200);
    const entry = (queue.body.pending as { duplicataId: string; score: number; breakdown: unknown[] }[]).find(
      (p) => p.duplicataId === result.duplicataId
    );
    expect(entry).toBeTruthy();
    expect(entry!.score).toBeGreaterThanOrEqual(80);
    expect(entry!.breakdown.length).toBeGreaterThan(0);

    // Admin can liberate it — never a permanent automatic block.
    const decide = await request(app)
      .post(`/api/admin/compliance-queue/${result.duplicataId}/decidir`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ decision: 'liberado', note: 'Revisado manualmente — falso positivo de duplicidade.' });
    expect(decide.status).toBe(200);

    const queueAfter = await request(app).get('/api/admin/compliance-queue').set('Authorization', `Bearer ${admin}`);
    expect((queueAfter.body.pending as { duplicataId: string }[]).some((p) => p.duplicataId === result.duplicataId)).toBe(false);

    // Achado corrigido: canDisparar agora também exige aceite confirmado do sacado.
    setAceiteStatus(getAceiteByDuplicata(result.duplicataId)!.id, 'aceita');

    const minhas = await request(app).get('/api/minhas').set('Authorization', `Bearer ${cedenteFlagged}`);
    const own = (minhas.body.duplicatas as { id: string; status: string; canDisparar: boolean }[]).find((d) => d.id === result.duplicataId);
    expect(own!.status).toBe('Aprovada');
    expect(own!.canDisparar).toBe(true);
  });

  it('requires admin role for the compliance queue', async () => {
    const token = await registerCedente(`Sem Acesso ${unique()} Ltda`);
    const res = await request(app).get('/api/admin/compliance-queue').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});
