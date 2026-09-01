import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';

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

async function registerCedente(companyName: string, plan: 'basico' | 'pro' | 'empresarial' = 'basico') {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Cedente Teste', email: `ced-newapi-${unique()}@example.com`, password: 'senha123', companyName, role: 'cedente' });
  const token = res.body.token as string;
  if (plan !== 'basico') await request(app).post('/api/billing/checkout').set('Authorization', `Bearer ${token}`).send({ plan });
  return { token, userId: res.body.user.id as number };
}

async function generateKey(token: string, body: Record<string, unknown> = {}) {
  const res = await request(app).post('/api/dev/keys/generate').set('Authorization', `Bearer ${token}`).send(body);
  expect(res.status).toBe(200);
  return res.body.rawKey as string;
}

async function addonSummary(token: string, kind: string) {
  const res = await request(app).get('/api/admin/addons/cobrancas').set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  return (res.body.resumo as { kind: string; totalFmt: string; count: number }[]).find((r) => r.kind === kind)!;
}

describe('Feature — Judicial Records API', () => {
  it('is honestly unavailable (never charges) when no provider is configured, and enforces product scoping', async () => {
    const { token } = await registerCedente(`Cedente Judicial ${unique()} Ltda`, 'empresarial');
    const key = await generateKey(token, { mode: 'live', scope: 'read_only', product: 'judicial_records_api' });

    const admin = await adminToken();
    const before = await addonSummary(admin, 'judicial_records_api');
    const res = await request(app).post('/api/v1/judicial/consulta').set('Authorization', `Bearer ${key}`).send({ cnpj: '12.345.678/0001-90' });
    expect(res.status).toBe(503);
    const after = await addonSummary(admin, 'judicial_records_api');
    expect(after.count).toBe(before.count);

    // A key scoped to this product can't reach an unrelated v1 route.
    const scoreAttempt = await request(app).get('/api/v1/sacados/12.345.678%2F0001-90/score').set('Authorization', `Bearer ${key}`);
    expect(scoreAttempt.status).toBe(403);
  });
});

describe('Feature — Fraud Screening API', () => {
  it('flags self-dealing and concentration, bills a dedicated key, and is free on a platform key', async () => {
    const { token } = await registerCedente(`Cedente Fraude ${unique()} Ltda`, 'empresarial');
    const key = await generateKey(token, { mode: 'live', scope: 'read_write', product: 'fraud_screening_api' });

    const admin = await adminToken();
    const before = await addonSummary(admin, 'fraud_screening_api');
    const res = await request(app)
      .post('/api/v1/fraude/avaliar')
      .set('Authorization', `Bearer ${key}`)
      .send({ cedenteNome: 'Empresa X Ltda', sacadoNome: 'Empresa X Ltda', valor: 10000 });
    expect(res.status).toBe(200);
    expect(res.body.flagged).toBe(true);
    expect(res.body.findings.some((f: { tipo: string }) => f.tipo === 'autorrelacionamento')).toBe(true);
    const after = await addonSummary(admin, 'fraud_screening_api');
    expect(after.count).toBe(before.count + 1);

    const platformKey = await generateKey(token, { mode: 'live', scope: 'read_write', product: 'platform' });
    const freeCall = await request(app)
      .post('/api/v1/fraude/avaliar')
      .set('Authorization', `Bearer ${platformKey}`)
      .send({ cedenteNome: 'Fornecedor Real Ltda', sacadoNome: 'Comprador Real Ltda', valor: 5000 });
    expect(freeCall.status).toBe(200);
    expect(freeCall.body.flagged).toBe(false);
    const afterPlatform = await addonSummary(admin, 'fraud_screening_api');
    expect(afterPlatform.count).toBe(after.count); // platform key never charged for this product
  });

  it('flags concentration in a single sacado across the caller-supplied history', async () => {
    const { token } = await registerCedente(`Cedente Concentracao ${unique()} Ltda`, 'empresarial');
    const key = await generateKey(token, { mode: 'live', scope: 'read_write', product: 'fraud_screening_api' });
    const res = await request(app)
      .post('/api/v1/fraude/avaliar')
      .set('Authorization', `Bearer ${key}`)
      .send({
        cedenteNome: 'Fornecedor Concentrado Ltda',
        sacadoNome: 'Comprador Único Ltda',
        valor: 40000,
        historicoRecente: [
          { sacadoNome: 'Comprador Único Ltda', valor: 30000 },
          { sacadoNome: 'Comprador Único Ltda', valor: 20000 },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.findings.some((f: { tipo: string }) => f.tipo === 'concentracao_anomala')).toBe(true);
  });
});

describe('Feature — Document Intelligence API', () => {
  it('is honestly unavailable (never charges) when ANTHROPIC_API_KEY is not configured', async () => {
    const { token } = await registerCedente(`Cedente Documentos ${unique()} Ltda`, 'empresarial');
    const key = await generateKey(token, { mode: 'live', scope: 'read_write', product: 'document_intelligence_api' });

    const admin = await adminToken();
    const before = await addonSummary(admin, 'document_intelligence_api');
    const res = await request(app)
      .post('/api/v1/documentos/analisar')
      .set('Authorization', `Bearer ${key}`)
      .send({ tipo: 'nfe', arquivoBase64: Buffer.from('conteudo de teste').toString('base64'), mimeType: 'application/pdf' });
    expect(res.status).toBe(503);
    const after = await addonSummary(admin, 'document_intelligence_api');
    expect(after.count).toBe(before.count);
  });

  it('rejects a read-only key (requires write scope)', async () => {
    const { token } = await registerCedente(`Cedente Documentos RO ${unique()} Ltda`, 'empresarial');
    const key = await generateKey(token, { mode: 'live', scope: 'read_only', product: 'document_intelligence_api' });
    const res = await request(app)
      .post('/api/v1/documentos/analisar')
      .set('Authorization', `Bearer ${key}`)
      .send({ tipo: 'nfe', arquivoBase64: 'YQ==', mimeType: 'application/pdf' });
    expect(res.status).toBe(403);
  });
});

describe('Feature — Reconciliation API', () => {
  const OFX_SAMPLE = `OFXHEADER:100
DATA:OFXSGML
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260115
<TRNAMT>1500.00
<FITID>tx-001
<MEMO>Pagamento recebido
</STMTTRN>
</BANKTRANLIST></STMTRS></STMTRNRS></BANKMSGSRSV1></OFX>`;

  it('matches an expected transaction against a real OFX statement and bills a dedicated key', async () => {
    const { token } = await registerCedente(`Cedente Conciliacao ${unique()} Ltda`, 'empresarial');
    const key = await generateKey(token, { mode: 'live', scope: 'read_write', product: 'reconciliation_api' });

    const admin = await adminToken();
    const before = await addonSummary(admin, 'reconciliation_api');
    const res = await request(app)
      .post('/api/v1/conciliacao')
      .set('Authorization', `Bearer ${key}`)
      .send({ ofxContent: OFX_SAMPLE, esperado: [{ referencia: 'fatura-42', valor: 1500, data: '2026-01-15' }] });
    expect(res.status).toBe(200);
    expect(res.body.conferidas).toEqual([{ referencia: 'fatura-42', fitidExtrato: 'tx-001' }]);
    expect(res.body.semCorrespondenciaNoExtrato).toEqual([]);
    const after = await addonSummary(admin, 'reconciliation_api');
    expect(after.count).toBe(before.count + 1);
  });

  it('reports an unmatched expected transaction and an unexpected bank transaction', async () => {
    const { token } = await registerCedente(`Cedente Conciliacao Parcial ${unique()} Ltda`, 'empresarial');
    const key = await generateKey(token, { mode: 'live', scope: 'read_write', product: 'reconciliation_api' });
    const res = await request(app)
      .post('/api/v1/conciliacao')
      .set('Authorization', `Bearer ${key}`)
      .send({ ofxContent: OFX_SAMPLE, esperado: [{ referencia: 'fatura-nao-existe', valor: 9999, data: '2026-01-15' }] });
    expect(res.status).toBe(200);
    expect(res.body.conferidas).toEqual([]);
    expect(res.body.semCorrespondenciaNoExtrato).toHaveLength(1);
    expect(res.body.naoEsperadasNoExtrato).toHaveLength(1);
  });

  it('rejects a malformed OFX file with 400, not 503', async () => {
    const { token } = await registerCedente(`Cedente Conciliacao Malformada ${unique()} Ltda`, 'empresarial');
    const key = await generateKey(token, { mode: 'live', scope: 'read_write', product: 'reconciliation_api' });
    const res = await request(app).post('/api/v1/conciliacao').set('Authorization', `Bearer ${key}`).send({ ofxContent: 'isto não é um OFX', esperado: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ofx_parse_error');
  });
});

describe('Feature — Suitability API', () => {
  const VALID_ANSWERS = {
    objetivo: 'maximizar',
    horizonte: 'longo',
    tolerancia_perda: 'aportaria',
    experiencia: 'regular',
    concentracao: 'baixa',
    renda: 'estavel',
  };

  it('scores a valid questionnaire statelessly and bills a dedicated key', async () => {
    const { token } = await registerCedente(`Cedente Suitability ${unique()} Ltda`, 'empresarial');
    const key = await generateKey(token, { mode: 'live', scope: 'read_only', product: 'suitability_api' });

    const admin = await adminToken();
    const before = await addonSummary(admin, 'suitability_api');
    const res = await request(app).post('/api/v1/suitability/avaliar').set('Authorization', `Bearer ${key}`).send({ answers: VALID_ANSWERS });
    expect(res.status).toBe(200);
    expect(res.body.profile).toBe('arrojado');
    expect(res.body.profileLabel).toBe('Arrojado');
    expect(typeof res.body.score).toBe('number');
    expect(typeof res.body.maxScore).toBe('number');
    const after = await addonSummary(admin, 'suitability_api');
    expect(after.count).toBe(before.count + 1);
  });

  it('rejects an invalid answer with 400', async () => {
    const { token } = await registerCedente(`Cedente Suitability Invalida ${unique()} Ltda`, 'empresarial');
    const key = await generateKey(token, { mode: 'live', scope: 'read_only', product: 'suitability_api' });
    const res = await request(app)
      .post('/api/v1/suitability/avaliar')
      .set('Authorization', `Bearer ${key}`)
      .send({ answers: { ...VALID_ANSWERS, objetivo: 'opcao_invalida' } });
    expect(res.status).toBe(400);
  });
});

describe('Feature — Lastro Index', () => {
  it('returns a real aggregate and bills a dedicated key', async () => {
    const { token } = await registerCedente(`Cedente Index ${unique()} Ltda`, 'empresarial');
    const key = await generateKey(token, { mode: 'live', scope: 'read_only', product: 'market_index_api' });

    const admin = await adminToken();
    const before = await addonSummary(admin, 'market_index_api');
    const res = await request(app).get('/api/v1/index').set('Authorization', `Bearer ${key}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('totalDuplicatas');
    expect(res.body.porRating).toHaveLength(4);
    const after = await addonSummary(admin, 'market_index_api');
    expect(after.count).toBe(before.count + 1);
  });
});
