import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { chooseRegistradora } from '../src/lib/registradoras.js';

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function registerEmpresarialCedente() {
  const email = `ced-reg-${unique()}@example.com`;
  const reg = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Cedente', email, password: 'senha123', companyName: `Cedente ${unique()}`, role: 'cedente' });
  const token = reg.body.token as string;
  await request(app).post('/api/billing/checkout').set('Authorization', `Bearer ${token}`).send({ plan: 'empresarial' });
  return { token, userId: reg.body.user.id as number };
}

async function generateKey(token: string, body: Record<string, unknown> = {}) {
  const res = await request(app).post('/api/dev/keys/generate').set('Authorization', `Bearer ${token}`).send(body);
  return res.body.rawKey as string;
}

describe('chooseRegistradora', () => {
  it('routes small operations to the cheapest registradora', () => {
    expect(chooseRegistradora(10_000).key).toBe('grafeno');
  });

  it('routes large operations to a reliable-enough registradora even if not the absolute cheapest', () => {
    const picked = chooseRegistradora(1_500_000);
    expect(picked.key).not.toBe('grafeno');
    expect(picked.confiabilidadePct).toBeGreaterThanOrEqual(99);
  });
});

describe('emission is routed to a real registradora', () => {
  it('tags the emitted duplicata with the chosen registradora, surfaced in the response and the public API', async () => {
    const { token } = await registerEmpresarialCedente();
    let duplicataId = '';
    let registradoraNome = '';
    for (let attempt = 0; attempt < 8 && !duplicataId; attempt++) {
      const res = await request(app)
        .post('/api/emitir/submit')
        .set('Authorization', `Bearer ${token}`)
        .send({ sacado: 'Grupo Atlas Varejo', cnpj: '', valor: '5.000', vencimento: '2026-12-31', seguro: false, nfAnexada: true });
      if (res.status === 200) {
        duplicataId = res.body.duplicataId;
        registradoraNome = res.body.registradora;
      }
    }
    expect(duplicataId).not.toBe('');
    expect(['CERC', 'B3', 'Núclea', 'Grafeno (SPC)']).toContain(registradoraNome);

    const key = await generateKey(token);
    const consulta = await request(app).get(`/api/v1/duplicatas/${duplicataId}`).set('Authorization', `Bearer ${key}`);
    expect(consulta.status).toBe(200);
    expect(consulta.body.registradora).toBe(registradoraNome);
  });
});

describe('shared network risk-score', () => {
  it('returns fonte "interno" for a known sacado CNPJ with no network signals', async () => {
    const { token } = await registerEmpresarialCedente();
    const key = await generateKey(token);
    const res = await request(app).get('/api/v1/sacados/12.345.678%2F0001-90/score').set('Authorization', `Bearer ${key}`);
    expect(res.status).toBe(200);
    expect(res.body.fonte).toBe('interno');
    expect(res.body.sinaisDeRede).toBeNull();
  });

  it('404s for a CNPJ with neither internal history nor network signals', async () => {
    const { token } = await registerEmpresarialCedente();
    const key = await generateKey(token);
    const res = await request(app).get('/api/v1/sacados/00000000000191/score').set('Authorization', `Bearer ${key}`);
    expect(res.status).toBe(404);
  });

  it('lets a partner report a signal for a brand-new CNPJ and scores it purely from the network', async () => {
    const { token } = await registerEmpresarialCedente();
    const key = await generateKey(token);
    const novoCnpj = '11222333000181';

    const report = await request(app)
      .post(`/api/v1/sacados/${novoCnpj}/sinais`)
      .set('Authorization', `Bearer ${key}`)
      .send({ tipo: 'pagamento_pontual', nota: 'Pagou em dia via nosso sistema' });
    expect(report.status).toBe(200);
    expect(report.body.fonte).toBe('rede');
    expect(report.body.sinaisDeRede.total).toBe(1);

    const score = await request(app).get(`/api/v1/sacados/${novoCnpj}/score`).set('Authorization', `Bearer ${key}`);
    expect(score.status).toBe(200);
    expect(score.body.fonte).toBe('rede');
    expect(score.body.sinaisDeRede.pontual).toBe(1);
  });

  it('blends internal and network data, shifting the score down after protesto signals', async () => {
    const { token } = await registerEmpresarialCedente();
    const key = await generateKey(token, { scope: 'read_write' });
    const cnpj = '12345678000190'; // Grupo Atlas Varejo, internal score 84

    const before = await request(app).get(`/api/v1/sacados/${cnpj}/score`).set('Authorization', `Bearer ${key}`);
    expect(before.body.fonte).toBe('interno');
    const baseScore = before.body.score;

    for (let i = 0; i < 4; i++) {
      await request(app).post(`/api/v1/sacados/${cnpj}/sinais`).set('Authorization', `Bearer ${key}`).send({ tipo: 'protesto' });
    }

    const after = await request(app).get(`/api/v1/sacados/${cnpj}/score`).set('Authorization', `Bearer ${key}`);
    expect(after.status).toBe(200);
    expect(after.body.fonte).toBe('combinado');
    expect(after.body.score).toBeLessThan(baseScore);
    expect(after.body.sinaisDeRede.protesto).toBe(4);
  });

  it('forbids a read_only key from reporting a signal', async () => {
    const { token } = await registerEmpresarialCedente();
    const key = await generateKey(token, { scope: 'read_only' });
    const res = await request(app)
      .post('/api/v1/sacados/99988877000166/sinais')
      .set('Authorization', `Bearer ${key}`)
      .send({ tipo: 'pagamento_pontual' });
    expect(res.status).toBe(403);
  });
});

describe('real aceite outcomes auto-seed the network signal pool', () => {
  it('feeds a pagamento_pontual signal into the network when a sacado confirms on time', async () => {
    const { token: cedenteToken } = await registerEmpresarialCedente();
    const cnpj = '23456789000111'; // Metalúrgica Serrana S.A.

    let duplicataId = '';
    for (let attempt = 0; attempt < 8 && !duplicataId; attempt++) {
      const res = await request(app)
        .post('/api/emitir/submit')
        .set('Authorization', `Bearer ${cedenteToken}`)
        .send({ sacado: 'Metalúrgica Serrana S.A.', cnpj, valor: '5.000', vencimento: '2026-12-31', seguro: false, nfAnexada: true });
      if (res.status === 200) duplicataId = res.body.duplicataId;
    }
    expect(duplicataId).not.toBe('');

    const sacadoEmail = `sac-reg-${unique()}@example.com`;
    const sacadoReg = await request(app)
      .post('/api/auth/register')
      .send({ nome: 'Sacado', email: sacadoEmail, password: 'senha123', companyName: 'Metalúrgica Serrana S.A.', role: 'sacado' });
    const sacadoToken = sacadoReg.body.token as string;

    const list = await request(app).get('/api/aceites').set('Authorization', `Bearer ${sacadoToken}`);
    const aceite = list.body.aceites.find((a: { duplicataId: string }) => a.duplicataId === duplicataId);
    expect(aceite).toBeTruthy();

    await request(app).post(`/api/aceites/${aceite.id}/status`).set('Authorization', `Bearer ${sacadoToken}`).send({ status: 'aceita' });

    const { token: anyToken } = await registerEmpresarialCedente();
    const key = await generateKey(anyToken);
    const score = await request(app).get(`/api/v1/sacados/${cnpj}/score`).set('Authorization', `Bearer ${key}`);
    expect(score.status).toBe(200);
    expect(score.body.fonte).toBe('combinado');
    expect(score.body.sinaisDeRede.pontual).toBeGreaterThanOrEqual(1);
  });
});
