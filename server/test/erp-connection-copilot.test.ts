import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';

// Copiloto de diagnóstico de conexão ERP (lib/erpConnectionCopilot.ts) — sob demanda,
// nunca decide nada sozinho. Sem ANTHROPIC_API_KEY (ambiente de teste), o fallback
// real-when-configured retorna null em vez de fabricar uma causa/próximo passo.

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function registerCedente(companyName: string) {
  const res = await request(app).post('/api/auth/register').send({
    nome: 'Cedente Teste',
    email: `ced-erp-diag-${unique()}@example.com`,
    password: 'senha123',
    companyName,
    role: 'cedente',
  });
  return res.body.token as string;
}

describe('POST /api/erp/diagnostico', () => {
  it('retorna diagnóstico null sem ANTHROPIC_API_KEY configurada (real-when-configured)', async () => {
    const token = await registerCedente(`Fornecedora Diag ERP ${unique()} Ltda`);
    const res = await request(app)
      .post('/api/erp/diagnostico')
      .set('Authorization', `Bearer ${token}`)
      .send({ connector: 'sap', error: 'sap_login_failed: 401 {"error":{"message":{"value":"Invalid credentials"}}}' });
    expect(res.status).toBe(200);
    expect(res.body.diagnosis).toBeNull();
  });

  it('valida o conector e a mensagem de erro', async () => {
    const token = await registerCedente(`Fornecedora Diag ERP Inválida ${unique()} Ltda`);
    const badConnector = await request(app).post('/api/erp/diagnostico').set('Authorization', `Bearer ${token}`).send({ connector: 'oracle', error: 'algo' });
    expect(badConnector.status).toBe(400);

    const noError = await request(app).post('/api/erp/diagnostico').set('Authorization', `Bearer ${token}`).send({ connector: 'totvs', error: '' });
    expect(noError.status).toBe(400);
  });

  it('exige autenticação', async () => {
    const res = await request(app).post('/api/erp/diagnostico').send({ connector: 'omie', error: 'omie_http_500' });
    expect(res.status).toBe(401);
  });
});
