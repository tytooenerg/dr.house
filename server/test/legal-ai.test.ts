import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { getAceiteByDuplicata, setAceiteStatus } from '../src/db/aceites.js';
import { screenJudicialRecords } from '../src/lib/judicialRecords.js';

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

async function registerCedente(companyName: string) {
  const res = await request(app).post('/api/auth/register').send({
    nome: 'Cedente Teste',
    email: `ced-legal-${unique()}@example.com`,
    password: 'senha123',
    companyName,
    role: 'cedente',
  });
  return res.body.token as string;
}

async function submitEmitir(token: string, overrides: Partial<{ vencimento: string; valor: string }> = {}) {
  let lastStatus = 0;
  let body: Record<string, unknown> = {};
  for (let attempt = 0; attempt < 10; attempt++) {
    const res = await request(app)
      .post('/api/emitir/submit')
      .set('Authorization', `Bearer ${token}`)
      .send({
        sacado: 'Grupo Atlas Varejo',
        cnpj: '12.345.678/0001-90',
        valor: overrides.valor ?? '8.000',
        vencimento: overrides.vencimento ?? '2020-01-10',
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
  return body as { duplicataId: string };
}

describe('Cobrança jurídica (IA)', () => {
  it('requires admin role', async () => {
    const cedente = await registerCedente(`Sem Acesso Cobranca ${unique()} Ltda`);
    const res = await request(app).get('/api/admin/juridico/cobranca').set('Authorization', `Bearer ${cedente}`);
    expect(res.status).toBe(403);
  });

  it('is not eligible until aceite is confirmed, then becomes eligible', async () => {
    const admin = await adminToken();
    const cedente = await registerCedente(`Fornecedora Cobranca ${unique()} Ltda`);
    const emitted = await submitEmitir(cedente, { vencimento: '2020-01-10' });

    const list1 = await request(app).get('/api/admin/juridico/cobranca').set('Authorization', `Bearer ${admin}`);
    expect(list1.status).toBe(200);
    const item1 = (list1.body.overdue as { duplicataId: string; eligible: boolean; reason: string | null }[]).find((o) => o.duplicataId === emitted.duplicataId);
    expect(item1).toBeTruthy();
    expect(item1!.eligible).toBe(false);
    expect(item1!.reason).toMatch(/[Aa]ceite/);

    const aceite = getAceiteByDuplicata(emitted.duplicataId)!;
    setAceiteStatus(aceite.id, 'aceita');

    const list2 = await request(app).get('/api/admin/juridico/cobranca').set('Authorization', `Bearer ${admin}`);
    const item2 = (list2.body.overdue as { duplicataId: string; eligible: boolean }[]).find((o) => o.duplicataId === emitted.duplicataId);
    expect(item2!.eligible).toBe(true);
  });

  it('blocks generation when not eligible (409) and reports AI unavailable when eligible but unconfigured (503)', async () => {
    const admin = await adminToken();
    const cedente = await registerCedente(`Fornecedora Sem IA ${unique()} Ltda`);
    const emitted = await submitEmitir(cedente, { vencimento: '2020-02-10' });

    const blocked = await request(app)
      .post(`/api/admin/juridico/cobranca/${emitted.duplicataId}/notificacao_cobranca`)
      .set('Authorization', `Bearer ${admin}`);
    expect(blocked.status).toBe(409);

    const aceite = getAceiteByDuplicata(emitted.duplicataId)!;
    setAceiteStatus(aceite.id, 'aceita');

    const noAi = await request(app)
      .post(`/api/admin/juridico/cobranca/${emitted.duplicataId}/notificacao_cobranca`)
      .set('Authorization', `Bearer ${admin}`);
    expect(noAi.status).toBe(503);
  });

  it('rejects an invalid document type', async () => {
    const admin = await adminToken();
    const res = await request(app).post('/api/admin/juridico/cobranca/DUP-nonexistent/tipo_invalido').set('Authorization', `Bearer ${admin}`);
    expect(res.status).toBe(400);
  });
});

describe('Minutas jurídicas (IA)', () => {
  it('requires admin role and reports AI unavailable when unconfigured', async () => {
    const cedente = await registerCedente(`Sem Acesso Minuta ${unique()} Ltda`);
    const denied = await request(app)
      .post('/api/admin/juridico/minutas')
      .set('Authorization', `Bearer ${cedente}`)
      .send({ type: 'resposta_lgpd', context: 'teste' });
    expect(denied.status).toBe(403);

    const admin = await adminToken();
    const res = await request(app)
      .post('/api/admin/juridico/minutas')
      .set('Authorization', `Bearer ${admin}`)
      .send({ type: 'resposta_lgpd', context: 'Titular solicitou exclusão de dados.' });
    expect(res.status).toBe(503);
  });

  it('validates the request body', async () => {
    const admin = await adminToken();
    const res = await request(app).post('/api/admin/juridico/minutas').set('Authorization', `Bearer ${admin}`).send({ type: 'tipo_invalido', context: 'x' });
    expect(res.status).toBe(400);
  });
});

describe('Monitor regulatório (IA)', () => {
  it('requires admin role and reports AI unavailable when unconfigured', async () => {
    const cedente = await registerCedente(`Sem Acesso Reg ${unique()} Ltda`);
    const denied = await request(app)
      .post('/api/admin/juridico/regulatorio')
      .set('Authorization', `Bearer ${cedente}`)
      .send({ title: 'Teste', sourceText: 'Texto normativo de teste com mais de vinte caracteres.' });
    expect(denied.status).toBe(403);

    const admin = await adminToken();
    const res = await request(app)
      .post('/api/admin/juridico/regulatorio')
      .set('Authorization', `Bearer ${admin}`)
      .send({ title: 'Resolução Teste', sourceText: 'Texto normativo de teste com mais de vinte caracteres para validação.' });
    expect(res.status).toBe(503);
  });
});

describe('Verificação de histórico judicial (real-when-configured)', () => {
  it('returns null when JUDICIAL_RECORDS_API_URL/KEY is not configured', async () => {
    const result = await screenJudicialRecords('12.345.678/0001-90');
    expect(result).toBeNull();
  });
});
