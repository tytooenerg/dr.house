import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function registerCedente(companyName = `Emissora ${unique()} Ltda`) {
  const email = `ced-comp-${unique()}@example.com`;
  const res = await request(app).post('/api/auth/register').send({
    nome: 'Cedente Teste',
    email,
    password: 'senha123',
    companyName,
    role: 'cedente',
  });
  return res.body.token as string;
}

async function emitir(token: string, form: Record<string, unknown>) {
  // Retries past emitirCore's 12% simulated CERC failure chance, same pattern as emitir.test.ts.
  let res: request.Response | undefined;
  for (let attempt = 0; attempt < 10; attempt++) {
    res = await request(app).post('/api/emitir/submit').set('Authorization', `Bearer ${token}`).send(form);
    if (res.status !== 502) break;
  }
  return res!;
}

describe('NF-e chave duplicidade prevention', () => {
  it('blocks a second duplicata backed by an NF-e chave already used by another', async () => {
    const token = await registerCedente();
    const chave = '1'.repeat(44);
    const base = { sacado: 'Cliente Chave', cnpj: '11.222.333/0001-81', valor: '15.000', vencimento: '2026-11-01', seguro: false, nfAnexada: false, batchValores: [] };

    const first = await emitir(token, { ...base, nfeChave: chave });
    expect(first.status).toBe(200);

    const second = await emitir(token, { ...base, nfeChave: chave });
    expect(second.status).toBe(409);
    expect(second.body.error).toBe('nfe_duplicidade');
  });

  it('rejects a malformed chave (not 44 digits)', async () => {
    const token = await registerCedente();
    const res = await request(app)
      .post('/api/emitir/submit')
      .set('Authorization', `Bearer ${token}`)
      .send({ sacado: 'X', cnpj: '', valor: '1.000', vencimento: '2026-01-01', seguro: false, nfAnexada: false, nfeChave: '12345', batchValores: [] });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/compliance/dup-check', () => {
  it('flags possible duplicidade when the same sacado/valor/vencimento is registered by two different cedentes', async () => {
    const cnpj = '22.333.444/0001-55';
    const shared = { sacado: 'Sacado Compartilhado', cnpj, valor: '77.777', vencimento: '2026-12-15', seguro: false, nfAnexada: false, batchValores: [] };

    const tokenA = await registerCedente();
    const tokenB = await registerCedente();
    const a = await emitir(tokenA, shared);
    const b = await emitir(tokenB, shared);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);

    const check = await request(app).post('/api/compliance/dup-check').set('Authorization', `Bearer ${tokenA}`).send({ query: cnpj });
    expect(check.status).toBe(200);
    expect(check.body.duplicidadeEncontrada).toBe(true);
    expect(check.body.matches.some((m: { duplicidadeSuspeita: boolean }) => m.duplicidadeSuspeita)).toBe(true);
  });

  it('finds nothing for an empty query', async () => {
    const token = await registerCedente();
    const check = await request(app).post('/api/compliance/dup-check').set('Authorization', `Bearer ${token}`).send({ query: '' });
    expect(check.status).toBe(200);
    expect(check.body.duplicidadeEncontrada).toBe(false);
    expect(check.body.matches).toEqual([]);
  });
});

describe('PLD/FT demo screening at KYB submission', () => {
  it('flags a company name matching the demonstration watchlist', async () => {
    const email = `inv-pld-${unique()}@example.com`;
    const reg = await request(app).post('/api/auth/register').send({
      nome: 'Investidor',
      email,
      password: 'senha123',
      companyName: 'Comercial Exemplo Sancionada Ltda',
      role: 'investidor',
    });
    const token = reg.body.token as string;
    const kyb = await request(app).post('/api/auth/kyb').set('Authorization', `Bearer ${token}`).send({ cnpj: '99.999.999/0001-99', tipo: 'Fundo (FIDC)', pl: '1.000.000' });
    expect(kyb.status).toBe(200);

    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(me.body.user.pldStatus).toBe('flagged');
  });

  it('leaves an unmatched company name clear', async () => {
    const email = `inv-clear-${unique()}@example.com`;
    const reg = await request(app).post('/api/auth/register').send({
      nome: 'Investidor',
      email,
      password: 'senha123',
      companyName: `Fundo Idôneo ${unique()}`,
      role: 'investidor',
    });
    const token = reg.body.token as string;
    await request(app).post('/api/auth/kyb').set('Authorization', `Bearer ${token}`).send({ cnpj: '11.111.111/0001-11', tipo: 'Fundo (FIDC)', pl: '1.000.000' });

    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(me.body.user.pldStatus).toBe('clear');
  });
});

describe('Aceite legal SLA', () => {
  it('sets a ~15-day deadline on the aceite created by emitting a duplicata', async () => {
    const token = await registerCedente();
    const res = await emitir(token, { sacado: 'Sacado SLA', cnpj: '33.444.555/0001-66', valor: '9.000', vencimento: '2026-12-01', seguro: false, nfAnexada: false, batchValores: [] });
    expect(res.status).toBe(200);

    const aceites = await request(app).get('/api/aceites').set('Authorization', `Bearer ${token}`);
    const aceite = aceites.body.aceites.find((a: { duplicataId: string }) => a.duplicataId === res.body.duplicataId);
    expect(aceite).toBeTruthy();
    expect(aceite.slaDiasRestantes).toBeGreaterThanOrEqual(14);
    expect(aceite.slaDiasRestantes).toBeLessThanOrEqual(15);
    expect(aceite.slaVencido).toBe(false);
  });
});

describe('GET /api/compliance/provisionamento', () => {
  it('returns an empty summary for an investor with no purchases', async () => {
    const email = `inv-prov-${unique()}@example.com`;
    const reg = await request(app).post('/api/auth/register').send({
      nome: 'Investidor',
      email,
      password: 'senha123',
      companyName: `Fundo ${unique()}`,
      role: 'investidor',
    });
    const token = reg.body.token as string;
    const res = await request(app).get('/api/compliance/provisionamento').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.rows).toEqual([]);
    expect(res.body.summary).toEqual({ estagio_1: 0, estagio_2: 0, estagio_3: 0 });
  });
});
