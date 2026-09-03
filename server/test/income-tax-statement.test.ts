import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { approveKyb } from '../src/db/users.js';
import { createDuplicata, createPurchase } from '../src/db/duplicatas.js';
import { db } from '../src/db/index.js';
import { aliquotaForDias, buildIncomeTaxStatement } from '../src/lib/incomeTaxStatement.js';

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function registerInvestidor() {
  const email = `inv-ir-${unique()}@example.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Investidor', email, password: 'senha123', companyName: `Fundo ${unique()}`, role: 'investidor' });
  approveKyb(res.body.user.id);
  return { token: res.body.token as string, userId: res.body.user.id as number };
}

describe('IR regressive table — real bracket boundaries', () => {
  it('picks the correct bracket at and around each boundary', () => {
    expect(aliquotaForDias(1).aliquota).toBe(0.225);
    expect(aliquotaForDias(180).aliquota).toBe(0.225);
    expect(aliquotaForDias(181).aliquota).toBe(0.2);
    expect(aliquotaForDias(360).aliquota).toBe(0.2);
    expect(aliquotaForDias(361).aliquota).toBe(0.175);
    expect(aliquotaForDias(720).aliquota).toBe(0.175);
    expect(aliquotaForDias(721).aliquota).toBe(0.15);
    expect(aliquotaForDias(3650).aliquota).toBe(0.15);
  });
});

describe('Informe de rendimentos — real per-operation IR estimate', () => {
  it('computes bruto/IR/líquido for a real purchase held ~90 days (22,5% bracket)', async () => {
    const currentYear = new Date().getUTCFullYear();
    const { userId } = await registerInvestidor();
    const vencimento = new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const d = createDuplicata({
      cedenteId: null,
      cedenteNome: 'Cedente Teste',
      sacadoNome: 'IR Test Sacado',
      sacadoCnpj: '',
      valor: 10000,
      vencimento,
      emissao: '10/08/2026',
      status: 'aprovada',
      lastroPct: 100,
      seguro: false,
    });
    createPurchase(d.id, userId, 10000, '2,0%', 0);
    // Force a known, deterministic retorno for a clean assertion — createPurchase's own
    // retorno is randomized within a real range, which is fine for settlement but not for
    // asserting an exact IR figure here.
    db.prepare('UPDATE purchases SET retorno = 1000 WHERE duplicata_id = ?').run(d.id);

    const statement = buildIncomeTaxStatement(userId, 'Fundo Teste IR', currentYear);
    expect(statement.operacoesCount).toBe(1);
    const line = statement.lines[0];
    expect(line.diasCarencia).toBeGreaterThanOrEqual(88);
    expect(line.diasCarencia).toBeLessThanOrEqual(91);
    expect(line.aliquotaLabel).toContain('22,5%');
    expect(line.irEstimadoFmt.replace(/\D/g, '')).toBe('225'); // 1000 * 0.225 = 225
    expect(line.rendimentoLiquidoFmt.replace(/\D/g, '')).toBe('775'); // 1000 - 225 = 775
    expect(statement.totalRendimentoBrutoFmt.replace(/\D/g, '')).toBe('1000');
  });

  it('excludes operations from other years', async () => {
    const { userId } = await registerInvestidor();
    const d = createDuplicata({
      cedenteId: null,
      cedenteNome: 'Cedente Teste',
      sacadoNome: 'IR Test Sacado 2',
      sacadoCnpj: '',
      valor: 5000,
      vencimento: '2026-12-31',
      emissao: '10/08/2026',
      status: 'aprovada',
      lastroPct: 100,
      seguro: false,
    });
    createPurchase(d.id, userId, 5000, '2,0%', 0);
    const statement = buildIncomeTaxStatement(userId, 'Fundo Teste IR 2', 2019);
    expect(statement.operacoesCount).toBe(0);
    expect(statement.totalRendimentoBrutoFmt).toContain('0');
  });
});

describe('Informe de rendimentos — real routes', () => {
  it('returns the current year by default and accepts an explicit ?year=', async () => {
    const { token } = await registerInvestidor();
    const currentYear = new Date().getUTCFullYear();
    const res = await request(app).get('/api/historico/informe-rendimentos').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.year).toBe(currentYear);

    const explicit = await request(app).get('/api/historico/informe-rendimentos?year=2024').set('Authorization', `Bearer ${token}`);
    expect(explicit.body.year).toBe(2024);
  });

  it('ignores an out-of-range year and falls back to the current year', async () => {
    const { token } = await registerInvestidor();
    const res = await request(app).get('/api/historico/informe-rendimentos?year=1899').set('Authorization', `Bearer ${token}`);
    expect(res.body.year).toBe(new Date().getUTCFullYear());
  });

  it('streams a real PDF', async () => {
    const { token } = await registerInvestidor();
    const res = await request(app).get('/api/historico/informe-rendimentos.pdf').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
  });
});
