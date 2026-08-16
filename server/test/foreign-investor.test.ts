import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { isLowTaxJurisdiction } from '../src/data/lowTaxJurisdictions.js';
import { parseUnConsolidatedXml } from '../src/lib/sanctionsFeed.js';
import { checkForeignInvestorEligibility, FOREIGN_INVESTOR_DISCLAIMER } from '../src/lib/foreignInvestorCompliance.js';
import { getUserById } from '../src/db/users.js';

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

async function registerInvestidor(companyName: string) {
  const res = await request(app).post('/api/auth/register').send({
    nome: 'Investidor Estrangeiro',
    email: `inv-inr-${unique()}@example.com`,
    password: 'senha123',
    companyName,
    role: 'investidor',
  });
  return { token: res.body.token as string, userId: res.body.user.id as number };
}

describe('isLowTaxJurisdiction — IN RFB 1.037/2010 snapshot', () => {
  it('flags known low-tax jurisdictions regardless of case/accents', () => {
    expect(isLowTaxJurisdiction('Ilhas Cayman')).toBe(true);
    expect(isLowTaxJurisdiction('CINGAPURA')).toBe(true);
    expect(isLowTaxJurisdiction('bahamas')).toBe(true);
    expect(isLowTaxJurisdiction('panama')).toBe(true);
  });

  it('does not flag ordinary jurisdictions', () => {
    expect(isLowTaxJurisdiction('Estados Unidos')).toBe(false);
    expect(isLowTaxJurisdiction('Alemanha')).toBe(false);
    expect(isLowTaxJurisdiction('')).toBe(false);
  });
});

describe('parseUnConsolidatedXml — UN Security Council Consolidated List parser', () => {
  it('extracts individuals (name parts joined) and entities (full name) with their list type', () => {
    const xml = `<?xml version="1.0"?>
<CONSOLIDATED_LIST>
  <INDIVIDUALS>
    <INDIVIDUAL>
      <DATAID>1</DATAID>
      <FIRST_NAME>Fulano</FIRST_NAME>
      <SECOND_NAME>De</SECOND_NAME>
      <THIRD_NAME>Tal</THIRD_NAME>
      <UN_LIST_TYPE>Al-Qaida</UN_LIST_TYPE>
    </INDIVIDUAL>
  </INDIVIDUALS>
  <ENTITIES>
    <ENTITY>
      <DATAID>2</DATAID>
      <FIRST_NAME>Empresa Fictícia Ltda</FIRST_NAME>
      <UN_LIST_TYPE>Taliban</UN_LIST_TYPE>
    </ENTITY>
  </ENTITIES>
</CONSOLIDATED_LIST>`;
    const entries = parseUnConsolidatedXml(xml);
    expect(entries).toContainEqual({ nome: 'Fulano De Tal', programa: 'Al-Qaida' });
    expect(entries).toContainEqual({ nome: 'Empresa Fictícia Ltda', programa: 'Taliban' });
  });

  it('fails open (empty array, no throw) on malformed or empty XML', () => {
    expect(parseUnConsolidatedXml('')).toEqual([]);
    expect(parseUnConsolidatedXml('<not-the-expected-schema/>')).toEqual([]);
  });
});

describe('POST /auth/kyb — non-resident investor fields', () => {
  it('stores INR fields and the admin sees the naoResidente flag', async () => {
    const companyName = `Foreign Bank ${unique()} LLC`;
    const { token, userId } = await registerInvestidor(companyName);
    const submit = await request(app)
      .post('/api/auth/kyb')
      .set('Authorization', `Bearer ${token}`)
      .send({
        naoResidente: true,
        paisDomicilio: 'Estados Unidos',
        taxIdEstrangeiro: '12-3456789',
        representanteLegal: 'Banco XP S.A.',
        tipo: 'Banco comercial',
        pl: '50.000.000',
      });
    expect(submit.status).toBe(200);
    expect(submit.body.user.kybPending).toBe(true);

    const admin = await adminToken();
    const pending = await request(app).get('/api/admin/kyb').set('Authorization', `Bearer ${admin}`);
    const entry = pending.body.pending.find((p: { id: number }) => p.id === userId);
    expect(entry).toBeTruthy();
    expect(entry.naoResidente).toBe(true);
    expect(entry.kybForm.paisDomicilio).toBe('Estados Unidos');
    expect(entry.kybForm.representanteLegal).toBe('Banco XP S.A.');
  });

  it('a domestic investor is never flagged as non-resident', async () => {
    const companyName = `Fundo Doméstico ${unique()} Ltda`;
    const { token, userId } = await registerInvestidor(companyName);
    await request(app).post('/api/auth/kyb').set('Authorization', `Bearer ${token}`).send({ cnpj: '11.222.333/0001-44', tipo: 'Fundo (FIDC)', pl: '5.000.000' });

    const admin = await adminToken();
    const pending = await request(app).get('/api/admin/kyb').set('Authorization', `Bearer ${admin}`);
    const entry = pending.body.pending.find((p: { id: number }) => p.id === userId);
    expect(entry.naoResidente).toBe(false);
  });
});

describe('checkForeignInvestorEligibility — deterministic memo', () => {
  it('classifies an institutional type as profissional and flags a low-tax jurisdiction', async () => {
    const companyName = `Cayman Fund ${unique()} Ltd`;
    const { token, userId } = await registerInvestidor(companyName);
    await request(app)
      .post('/api/auth/kyb')
      .set('Authorization', `Bearer ${token}`)
      .send({ naoResidente: true, paisDomicilio: 'Ilhas Cayman', taxIdEstrangeiro: 'KY-000111', representanteLegal: 'Itaú BBA', tipo: 'Fundo (FIDC)' });

    const user = getUserById(userId)!;
    const result = await checkForeignInvestorEligibility(user);
    expect(result.classificacao).toBe('profissional');
    expect(result.jurisdicaoFavorecida).toBe(true);
    expect(result.memo).toContain(FOREIGN_INVESTOR_DISCLAIMER);
    expect(result.memo).toContain('SIM — consta na lista');
    // Stablecoin settlement rail (lib/stablecoinRail.ts) — unconfigured in tests, so the
    // memo must say so honestly instead of claiming a real funding channel exists.
    expect(result.memo).toContain('Via de liquidação para aporte: Nenhum rail de stablecoin configurado');
  });

  it('leaves classification unresolved for a non-institutional type and clears a normal jurisdiction', async () => {
    const companyName = `Non Institutional Investor ${unique()} Inc`;
    const { token, userId } = await registerInvestidor(companyName);
    await request(app)
      .post('/api/auth/kyb')
      .set('Authorization', `Bearer ${token}`)
      .send({ naoResidente: true, paisDomicilio: 'Alemanha', taxIdEstrangeiro: 'DE-999', representanteLegal: 'Safra' });

    const user = getUserById(userId)!;
    const result = await checkForeignInvestorEligibility(user);
    expect(result.classificacao).toBe('nao_classificado');
    expect(result.jurisdicaoFavorecida).toBe(false);
    expect(result.pldStatus).toBe('clear');
  });

  // The disclaimer must survive verbatim regardless of the computed facts — it's not
  // assembled by an LLM, so there's no scenario where it could be silently dropped.
  it('the fixed disclaimer never changes based on classification or jurisdiction', async () => {
    const companyName = `Disclaimer Check ${unique()} SA`;
    const { token, userId } = await registerInvestidor(companyName);
    await request(app)
      .post('/api/auth/kyb')
      .set('Authorization', `Bearer ${token}`)
      .send({ naoResidente: true, paisDomicilio: 'Suíça', taxIdEstrangeiro: 'CH-1', representanteLegal: 'BTG', tipo: 'Banco comercial' });
    const user = getUserById(userId)!;
    const result = await checkForeignInvestorEligibility(user);
    expect(result.memo.endsWith(FOREIGN_INVESTOR_DISCLAIMER)).toBe(true);
  });
});

describe('Admin: generate + list foreign investor eligibility memos', () => {
  it('generates a memo, persists it, and it appears in the list endpoint', async () => {
    const companyName = `Memo Flow Investor ${unique()} NV`;
    const { token, userId } = await registerInvestidor(companyName);
    await request(app)
      .post('/api/auth/kyb')
      .set('Authorization', `Bearer ${token}`)
      .send({ naoResidente: true, paisDomicilio: 'Holanda', taxIdEstrangeiro: 'NL-1', representanteLegal: 'BTG', tipo: 'Family office' });

    const admin = await adminToken();
    const gen = await request(app).post(`/api/admin/kyb/${userId}/elegibilidade-estrangeiro/gerar`).set('Authorization', `Bearer ${admin}`);
    expect(gen.status).toBe(200);
    expect(gen.body.screening.classificacao).toBe('profissional');
    expect(gen.body.screening.memo).toContain('MEMORANDO DE ELEGIBILIDADE');

    const list = await request(app).get(`/api/admin/kyb/${userId}/elegibilidade-estrangeiro`).set('Authorization', `Bearer ${admin}`);
    expect(list.status).toBe(200);
    expect(list.body.screenings.length).toBeGreaterThanOrEqual(1);
    expect(list.body.screenings[0].memo).toContain(FOREIGN_INVESTOR_DISCLAIMER);
  });

  it('404s for a non-existent user', async () => {
    const admin = await adminToken();
    const res = await request(app).post('/api/admin/kyb/999999999/elegibilidade-estrangeiro/gerar').set('Authorization', `Bearer ${admin}`);
    expect(res.status).toBe(404);
  });

  it('is forbidden for a non-admin', async () => {
    const { token, userId } = await registerInvestidor(`Non Admin Access ${unique()} Ltd`);
    const res = await request(app).get(`/api/admin/kyb/${userId}/elegibilidade-estrangeiro`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});
