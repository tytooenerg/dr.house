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

async function adminToken() {
  const res = await request(app).post('/api/auth/login').send({ email: 'admin@lastro.demo', password: 'demo1234' });
  return res.body.token as string;
}

async function investorToken() {
  const res = await request(app).post('/api/auth/login').send({ email: 'investidor@lastro.demo', password: 'demo1234' });
  return res.body.token as string;
}

async function registerCedente(companyName: string) {
  const res = await request(app).post('/api/auth/register').send({
    nome: 'Cedente Teste',
    email: `ced-fee-${unique()}@example.com`,
    password: 'senha123',
    companyName,
    role: 'cedente',
  });
  return res.body.token as string;
}

async function submitEmitir(token: string, overrides: Partial<{ vencimento: string; sacado: string; cnpj: string }> = {}) {
  let lastStatus = 0;
  let body: Record<string, unknown> = {};
  for (let attempt = 0; attempt < 10; attempt++) {
    const res = await request(app)
      .post('/api/emitir/submit')
      .set('Authorization', `Bearer ${token}`)
      .send({
        sacado: overrides.sacado ?? 'Grupo Atlas Varejo',
        cnpj: overrides.cnpj ?? '12.345.678/0001-90',
        valor: '10.000',
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

describe('Fee de sucesso — cobrança jurídica', () => {
  it('requires admin role and validates the configured percentage', async () => {
    const cedente = await registerCedente(`Sem Acesso Fee ${unique()} Ltda`);
    const denied = await request(app).get('/api/admin/juridico/cobranca-fee').set('Authorization', `Bearer ${cedente}`);
    expect(denied.status).toBe(403);

    const admin = await adminToken();
    const get = await request(app).get('/api/admin/juridico/cobranca-fee').set('Authorization', `Bearer ${admin}`);
    expect(get.status).toBe(200);
    expect(get.body.feePct).toBe(5);

    const tooHigh = await request(app).put('/api/admin/juridico/cobranca-fee').set('Authorization', `Bearer ${admin}`).send({ feePct: 80 });
    expect(tooHigh.status).toBe(400);

    const ok = await request(app).put('/api/admin/juridico/cobranca-fee').set('Authorization', `Bearer ${admin}`).send({ feePct: 7.5 });
    expect(ok.status).toBe(200);
    const getAfter = await request(app).get('/api/admin/juridico/cobranca-fee').set('Authorization', `Bearer ${admin}`);
    expect(getAfter.body.feePct).toBe(7.5);
  });

  it('charges the cedente when the duplicata was never sold, marks it paga, and refuses a second charge', async () => {
    const admin = await adminToken();
    const cedente = await registerCedente(`Fornecedora Recuperacao ${unique()} Ltda`);
    const emitted = await submitEmitir(cedente, { vencimento: '2020-02-15' });

    const blocked = await request(app).post(`/api/admin/juridico/cobranca/${emitted.duplicataId}/recuperar`).set('Authorization', `Bearer ${admin}`);
    expect(blocked.status).toBe(409);

    const aceite = getAceiteByDuplicata(emitted.duplicataId)!;
    setAceiteStatus(aceite.id, 'aceita');

    const recover = await request(app).post(`/api/admin/juridico/cobranca/${emitted.duplicataId}/recuperar`).set('Authorization', `Bearer ${admin}`);
    expect(recover.status).toBe(200);
    expect(recover.body.chargedRole).toBe('cedente');
    expect(recover.body.feeValor).toBeCloseTo(10_000 * (recover.body.feePct / 100), 2);

    // Recovered duplicata drops out of the overdue queue (status now 'paga').
    const list = await request(app).get('/api/admin/juridico/cobranca').set('Authorization', `Bearer ${admin}`);
    expect((list.body.overdue as { duplicataId: string }[]).some((o) => o.duplicataId === emitted.duplicataId)).toBe(false);

    const again = await request(app).post(`/api/admin/juridico/cobranca/${emitted.duplicataId}/recuperar`).set('Authorization', `Bearer ${admin}`);
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('already_recovered');

    const history = await request(app).get('/api/admin/juridico/recuperacoes').set('Authorization', `Bearer ${admin}`);
    expect((history.body.recuperacoes as { duplicataId: string }[]).some((r) => r.duplicataId === emitted.duplicataId)).toBe(true);
  });

  it('charges the investidor instead of the cedente once the duplicata was sold', async () => {
    const admin = await adminToken();
    const investor = await investorToken();
    const cedente = await registerCedente(`Fornecedora Vendida ${unique()} Ltda`);
    const emitted = await submitEmitir(cedente, { vencimento: '2020-03-20', sacado: 'Metalúrgica Serrana S.A.', cnpj: '23.456.789/0001-01' });

    const leilao = await request(app).post(`/api/minhas/${emitted.duplicataId}/leilao`).set('Authorization', `Bearer ${cedente}`);
    expect(leilao.status).toBe(200);

    const buy = await request(app).post(`/api/market/${emitted.duplicataId}/buy`).set('Authorization', `Bearer ${investor}`);
    expect(buy.status).toBe(200);

    const aceite = getAceiteByDuplicata(emitted.duplicataId)!;
    setAceiteStatus(aceite.id, 'aceita');

    const recover = await request(app).post(`/api/admin/juridico/cobranca/${emitted.duplicataId}/recuperar`).set('Authorization', `Bearer ${admin}`);
    expect(recover.status).toBe(200);
    expect(recover.body.chargedRole).toBe('investidor');
  });
});
