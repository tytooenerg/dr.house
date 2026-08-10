import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { approveKyb } from '../src/db/users.js';
import { createDuplicata, createPurchase } from '../src/db/duplicatas.js';
import { db } from '../src/db/index.js';
import { buildDarfSummary } from '../src/lib/darfGenerator.js';

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function adminToken() {
  const res = await request(app).post('/api/auth/login').send({ email: 'admin@lastro.demo', password: 'demo1234' });
  return res.body.token as string;
}

async function registerInvestidor() {
  const email = `inv-darf-${unique()}@example.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Investidor', email, password: 'senha123', companyName: `Fundo DARF ${unique()}`, role: 'investidor' });
  approveKyb(res.body.user.id);
  return { token: res.body.token as string, userId: res.body.user.id as number };
}

describe('DARF — real aggregate IRRF over a competência period', () => {
  it('aggregates real purchases maturing in the period, using the same IR bracket math as the informe de rendimentos', async () => {
    const { userId } = await registerInvestidor();
    const vencimento = '2031-06-15'; // a fixed, far-future month unlikely to collide with other seeded data in this file's fresh db
    const d = createDuplicata({
      cedenteId: null,
      cedenteNome: 'Cedente DARF Teste',
      sacadoNome: 'DARF Test Sacado',
      sacadoCnpj: '',
      valor: 20000,
      vencimento,
      emissao: '10/08/2026',
      status: 'aprovada',
      lastroPct: 100,
      seguro: false,
    });
    createPurchase(d.id, userId, 20000, '2,0%');
    db.prepare('UPDATE purchases SET retorno = 2000 WHERE duplicata_id = ?').run(d.id);

    const summary = buildDarfSummary('2031-06');
    expect(summary.operacoesCount).toBe(1);
    const line = summary.lines[0];
    expect(line.investorId).toBe(userId);
    expect(line.irEstimadoFmt.replace(/\D/g, '')).toBe('300'); // dias de carência > 720 => 15% de 2000 = 300
    expect(summary.valorPrincipalFmt.replace(/\D/g, '')).toBe('300');
    expect(summary.valorTotalFmt).toBe(summary.valorPrincipalFmt);
    expect(summary.codigoReceita).toBe('3426');
  });

  it('reports zero for a period with no real maturities', () => {
    const summary = buildDarfSummary('2005-01');
    expect(summary.operacoesCount).toBe(0);
    expect(summary.valorPrincipal).toBe(0);
  });
});

describe('DARF — admin routes', () => {
  it('requires admin role', async () => {
    const { token } = await registerInvestidor();
    const res = await request(app).get('/api/admin/juridico/darf?period=2031-06');
    expect(res.status).toBe(401);
    const forbidden = await request(app).get('/api/admin/juridico/darf?period=2031-06').set('Authorization', `Bearer ${token}`);
    expect(forbidden.status).toBe(403);
  });

  it('returns the real JSON summary and streams a real PDF', async () => {
    const admin = await adminToken();
    const json = await request(app).get('/api/admin/juridico/darf?period=2031-06').set('Authorization', `Bearer ${admin}`);
    expect(json.status).toBe(200);
    expect(json.body.period).toBe('2031-06');

    const pdf = await request(app).get('/api/admin/juridico/darf.pdf?period=2031-06').set('Authorization', `Bearer ${admin}`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
  });

  it('falls back to the current month for a malformed period', async () => {
    const admin = await adminToken();
    const res = await request(app).get('/api/admin/juridico/darf?period=not-a-period').set('Authorization', `Bearer ${admin}`);
    expect(res.status).toBe(200);
    expect(res.body.period).toBe(new Date().toISOString().slice(0, 7));
  });
});
