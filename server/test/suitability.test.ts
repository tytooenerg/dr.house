import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { approveKyb } from '../src/db/users.js';
import { upsertSuitability } from '../src/db/suitability.js';

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function registerInvestidor() {
  const email = `inv-suit-${unique()}@example.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Investidor', email, password: 'senha123', companyName: `Fundo ${unique()}`, role: 'investidor' });
  approveKyb(res.body.user.id);
  return { token: res.body.token as string, userId: res.body.user.id as number };
}

const CONSERVADOR_ANSWERS = {
  objetivo: 'preservar',
  horizonte: 'curto',
  tolerancia_perda: 'resgataria',
  experiencia: 'nenhuma',
  concentracao: 'alta',
  renda: 'instavel',
};

const ARROJADO_ANSWERS = {
  objetivo: 'maximizar',
  horizonte: 'longo',
  tolerancia_perda: 'aportaria',
  experiencia: 'regular',
  concentracao: 'baixa',
  renda: 'estavel',
};

describe('Suitability — questionnaire and profile computation', () => {
  it('lists the same real questions the scoring logic uses', async () => {
    const { token } = await registerInvestidor();
    const res = await request(app).get('/api/suitability').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.questions.length).toBeGreaterThanOrEqual(5);
    expect(res.body.current.hasAssessment).toBe(false);
  });

  it('computes conservador for the lowest-scoring answers and arrojado for the highest', async () => {
    const conservador = await registerInvestidor();
    const cRes = await request(app).post('/api/suitability/submit').set('Authorization', `Bearer ${conservador.token}`).send({ answers: CONSERVADOR_ANSWERS });
    expect(cRes.status).toBe(200);
    expect(cRes.body.profile).toBe('conservador');
    expect(cRes.body.hasAssessment).toBe(true);
    expect(cRes.body.expired).toBe(false);

    const arrojado = await registerInvestidor();
    const aRes = await request(app).post('/api/suitability/submit').set('Authorization', `Bearer ${arrojado.token}`).send({ answers: ARROJADO_ANSWERS });
    expect(aRes.status).toBe(200);
    expect(aRes.body.profile).toBe('arrojado');
  });

  it('rejects an incomplete or invalid answer set', async () => {
    const { token } = await registerInvestidor();
    const res = await request(app)
      .post('/api/suitability/submit')
      .set('Authorization', `Bearer ${token}`)
      .send({ answers: { objetivo: 'preservar' } });
    expect(res.status).toBe(400);
  });

  it('resubmitting overwrites the previous assessment rather than stacking a new row', async () => {
    const { token } = await registerInvestidor();
    await request(app).post('/api/suitability/submit').set('Authorization', `Bearer ${token}`).send({ answers: CONSERVADOR_ANSWERS });
    const second = await request(app).post('/api/suitability/submit').set('Authorization', `Bearer ${token}`).send({ answers: ARROJADO_ANSWERS });
    expect(second.body.profile).toBe('arrojado');
    const view = await request(app).get('/api/suitability').set('Authorization', `Bearer ${token}`);
    expect(view.body.current.profile).toBe('arrojado');
  });
});

describe('Suitability — gates the riskier cestas de investimento', () => {
  it('conservadora never requires an assessment', async () => {
    const { token } = await registerInvestidor();
    const res = await request(app).post('/api/cestas/investir').set('Authorization', `Bearer ${token}`).send({ cesta: 'conservadora', valor: '1.000' });
    expect(res.status).not.toBe(403);
  });

  it('diversificada and agressiva require a valid assessment when none exists', async () => {
    const { token } = await registerInvestidor();
    const diversificada = await request(app).post('/api/cestas/investir').set('Authorization', `Bearer ${token}`).send({ cesta: 'diversificada', valor: '1.000' });
    expect(diversificada.status).toBe(403);
    expect(diversificada.body.error).toBe('suitability_required');

    const agressiva = await request(app).post('/api/cestas/investir').set('Authorization', `Bearer ${token}`).send({ cesta: 'agressiva', valor: '1.000' });
    expect(agressiva.status).toBe(403);
    expect(agressiva.body.error).toBe('suitability_required');
  });

  it('a conservador profile is blocked from agressiva with suitability_mismatch, not suitability_required', async () => {
    const { token, userId } = await registerInvestidor();
    await request(app).post('/api/suitability/submit').set('Authorization', `Bearer ${token}`).send({ answers: CONSERVADOR_ANSWERS });
    const res = await request(app).post('/api/cestas/investir').set('Authorization', `Bearer ${token}`).send({ cesta: 'agressiva', valor: '1.000' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('suitability_mismatch');
    void userId;
  });

  it('an arrojado profile can use every cesta, including agressiva', async () => {
    const { token } = await registerInvestidor();
    await request(app).post('/api/suitability/submit').set('Authorization', `Bearer ${token}`).send({ answers: ARROJADO_ANSWERS });
    const res = await request(app).post('/api/cestas/investir').set('Authorization', `Bearer ${token}`).send({ cesta: 'agressiva', valor: '1.000' });
    expect(res.status).not.toBe(403);
  });

  it('an expired assessment is treated the same as no assessment at all', async () => {
    const { token, userId } = await registerInvestidor();
    // Backdate an otherwise-arrojado assessment past its validity window directly at the
    // DB layer — the real gate (lib/suitability.ts's checkCestaSuitability) must actually
    // check expires_at, not just whether a row exists.
    upsertSuitability(userId, 24, 'arrojado', JSON.stringify(ARROJADO_ANSWERS), new Date(Date.now() - 1000).toISOString());
    const res = await request(app).post('/api/cestas/investir').set('Authorization', `Bearer ${token}`).send({ cesta: 'agressiva', valor: '1.000' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('suitability_required');
  });
});
