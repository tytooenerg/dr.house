import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';

async function registerCedente() {
  const email = `cedente-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
  const res = await request(app).post('/api/auth/register').send({
    nome: 'Cedente Teste',
    email,
    password: 'senha123',
    companyName: 'Emissora Teste Ltda',
    role: 'cedente',
  });
  return res.body.token as string;
}

describe('POST /api/emitir/preview', () => {
  let token: string;
  beforeAll(async () => {
    token = await registerCedente();
  });

  it('is 0% complete for an empty form', async () => {
    const res = await request(app)
      .post('/api/emitir/preview')
      .set('Authorization', `Bearer ${token}`)
      .send({ sacado: '', cnpj: '', valor: '', vencimento: '', seguro: false, nfAnexada: false, batchValores: [] });
    expect(res.status).toBe(200);
    expect(res.body.lastroChecklist.pct).toBe(0);
  });

  it('reaches 100% once sacado, cnpj, valor, vencimento and NF-e are all present', async () => {
    const res = await request(app)
      .post('/api/emitir/preview')
      .set('Authorization', `Bearer ${token}`)
      .send({ sacado: 'Grupo Atlas Varejo', cnpj: '12.345.678/0001-90', valor: '50.000', vencimento: '2026-09-01', seguro: false, nfAnexada: true, batchValores: [] });
    expect(res.status).toBe(200);
    expect(res.body.lastroChecklist.pct).toBe(100);
    // "Grupo Atlas Varejo" is a known sacado in the static risk dataset.
    expect(res.body.sacadoRecognized).toBe(true);
  });

  it('requires auth', async () => {
    const res = await request(app).post('/api/emitir/preview').send({ sacado: 'X', valor: '1', vencimento: '2026-01-01' });
    expect(res.status).toBe(401);
  });
});

describe('POST /api/emitir/submit', () => {
  it('rejects submission when required fields are missing', async () => {
    const token = await registerCedente();
    const res = await request(app)
      .post('/api/emitir/submit')
      .set('Authorization', `Bearer ${token}`)
      .send({ sacado: '', valor: '', vencimento: '', seguro: false, nfAnexada: false, batchValores: [] });
    expect(res.status).toBe(400);
  });

  it('is forbidden for non-cedente roles', async () => {
    const res = await request(app).post('/api/auth/register').send({
      nome: 'Investidor',
      email: `inv-${Date.now()}@example.com`,
      password: 'senha123',
      companyName: 'Fundo X',
      role: 'investidor',
    });
    const token = res.body.token as string;
    const submit = await request(app)
      .post('/api/emitir/submit')
      .set('Authorization', `Bearer ${token}`)
      .send({ sacado: 'X', cnpj: '', valor: '1.000', vencimento: '2026-01-01', seguro: false, nfAnexada: false, batchValores: [] });
    expect(submit.status).toBe(403);
  });

  it('registers a duplicata and makes it appear in Minhas Duplicatas on success (retrying past the 12% CERC failure chance)', async () => {
    const token = await registerCedente();
    let lastStatus = 0;
    for (let attempt = 0; attempt < 10; attempt++) {
      const res = await request(app)
        .post('/api/emitir/submit')
        .set('Authorization', `Bearer ${token}`)
        .send({ sacado: 'Cliente Teste', cnpj: '00.000.000/0001-00', valor: '10.000', vencimento: '2026-10-01', seguro: false, nfAnexada: false, batchValores: [] });
      lastStatus = res.status;
      if (res.status === 200) {
        expect(res.body.registro).toMatch(/^ESC-2026-\d{6}$/);
        break;
      }
      expect(res.status).toBe(502);
    }
    expect(lastStatus).toBe(200);

    const minhas = await request(app).get('/api/minhas').set('Authorization', `Bearer ${token}`);
    expect(minhas.status).toBe(200);
    expect(minhas.body.duplicatas.some((d: { sacado: string }) => d.sacado === 'Cliente Teste')).toBe(true);
  });
});
