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

function currentMonthKey(): string {
  return new Date().toISOString().slice(0, 7);
}

async function adminToken() {
  const res = await request(app).post('/api/auth/login').send({ email: 'admin@lastro.demo', password: 'demo1234' });
  return res.body.token as string;
}

async function registerCedente(companyName: string, plan: 'basico' | 'pro' | 'empresarial' = 'basico') {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Cedente Teste', email: `ced-addon-${unique()}@example.com`, password: 'senha123', companyName, role: 'cedente' });
  const token = res.body.token as string;
  const userId = res.body.user.id as number;
  if (plan !== 'basico') await request(app).post('/api/billing/checkout').set('Authorization', `Bearer ${token}`).send({ plan });
  return { token, userId };
}

async function registerSacado(companyName: string) {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Sacado Teste', email: `sac-addon-${unique()}@example.com`, password: 'senha123', companyName, role: 'sacado' });
  return res.body.token as string;
}

async function registerInvestidor(plan: 'basico' | 'pro' | 'empresarial' = 'basico') {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Investidor Teste', email: `inv-addon-${unique()}@example.com`, password: 'senha123', companyName: `Investidor ${unique()}`, role: 'investidor' });
  const token = res.body.token as string;
  if (plan !== 'basico') await request(app).post('/api/billing/checkout').set('Authorization', `Bearer ${token}`).send({ plan });
  return token;
}

async function generateKey(token: string, body: Record<string, unknown> = {}) {
  const res = await request(app).post('/api/dev/keys/generate').set('Authorization', `Bearer ${token}`).send(body);
  expect(res.status).toBe(200);
  return res.body.rawKey as string;
}

async function submitEmitir(token: string, sacado: string) {
  let lastStatus = 0;
  let body: Record<string, unknown> = {};
  for (let attempt = 0; attempt < 10; attempt++) {
    const res = await request(app)
      .post('/api/emitir/submit')
      .set('Authorization', `Bearer ${token}`)
      .send({ sacado, cnpj: '', valor: '5.000', vencimento: '2020-01-10', seguro: false, nfAnexada: true, batchValores: [] });
    lastStatus = res.status;
    body = res.body;
    if (res.status === 200) break;
    expect(res.status).toBe(502);
  }
  expect(lastStatus).toBe(200);
  return body as { duplicataId: string };
}

async function addonSummary(token: string, kind: string) {
  const res = await request(app).get('/api/admin/addons/cobrancas').set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  return (res.body.resumo as { kind: string; totalFmt: string; count: number }[]).find((r) => r.kind === kind)!;
}

describe('Feature 1 — API usage overage billing', () => {
  it('charges a real, idempotent-per-month fee for live platform usage beyond the included quota', async () => {
    const { token } = await registerCedente(`Cedente Overage ${unique()} Ltda`, 'empresarial');
    const key = await generateKey(token, { mode: 'live', scope: 'read_write', product: 'platform' });

    const admin = await adminToken();
    await request(app).put('/api/admin/api-overage/config').set('Authorization', `Bearer ${admin}`).send({ included: 1 });

    // Any authenticated v1 call increments usage — hit a cheap read endpoint a few times.
    for (let i = 0; i < 3; i++) {
      await request(app).get('/api/v1/sacados/12.345.678%2F0001-90/score').set('Authorization', `Bearer ${key}`);
    }

    const before = await addonSummary(admin, 'api_overage');

    const period = currentMonthKey();
    const run1 = await request(app).post('/api/admin/api-overage/cobrar').set('Authorization', `Bearer ${admin}`).send({ period });
    expect(run1.status).toBe(200);
    expect(run1.body.charged).toBeGreaterThanOrEqual(1);

    const after = await addonSummary(admin, 'api_overage');
    expect(after.count).toBeGreaterThan(before.count);

    // Re-running the same period must not double-charge — chargeOncePerPeriod is idempotent.
    const run2 = await request(app).post('/api/admin/api-overage/cobrar').set('Authorization', `Bearer ${admin}`).send({ period });
    expect(run2.status).toBe(200);
    const afterRerun = await addonSummary(admin, 'api_overage');
    expect(afterRerun.count).toBe(after.count);

    // Restore the default quota so it doesn't leak into other tests running against the same process.
    await request(app).put('/api/admin/api-overage/config').set('Authorization', `Bearer ${admin}`).send({ included: 10_000 });
  });
});

describe('Feature 2 — Score API standalone product', () => {
  it('bills a narrow score_api key per call and restricts it to the score endpoint only', async () => {
    const { token } = await registerCedente(`Cedente Score ${unique()} Ltda`); // basico plan — narrow products aren't plan-gated
    const key = await generateKey(token, { mode: 'live', scope: 'read_only', product: 'score_api' });

    const admin = await adminToken();
    const before = await addonSummary(admin, 'score_api');

    const res = await request(app).get('/api/v1/sacados/12.345.678%2F0001-90/score').set('Authorization', `Bearer ${key}`);
    expect(res.status).toBe(200);

    const after = await addonSummary(admin, 'score_api');
    expect(after.count).toBe(before.count + 1);

    // A narrow product key can't reach any other v1 endpoint.
    const forbidden = await request(app).post('/api/v1/pld/triagem').set('Authorization', `Bearer ${key}`).send({ nome: 'Alguém' });
    expect(forbidden.status).toBe(403);
  });

  it('never double-bills a full platform key for the same score lookup', async () => {
    const { token } = await registerCedente(`Cedente Score Platform ${unique()} Ltda`, 'empresarial');
    const key = await generateKey(token, { mode: 'live', scope: 'read_only', product: 'platform' });

    const admin = await adminToken();
    const before = await addonSummary(admin, 'score_api');
    const res = await request(app).get('/api/v1/sacados/12.345.678%2F0001-90/score').set('Authorization', `Bearer ${key}`);
    expect(res.status).toBe(200);
    const after = await addonSummary(admin, 'score_api');
    expect(after.count).toBe(before.count);
  });
});

describe('Feature 3 — PLD/KYC screening as a service', () => {
  it('bills a narrow pld_screening_api key per call and restricts it to the triagem endpoint only', async () => {
    const { token } = await registerCedente(`Cedente PLD ${unique()} Ltda`);
    const key = await generateKey(token, { mode: 'live', scope: 'read_only', product: 'pld_screening_api' });

    const admin = await adminToken();
    const before = await addonSummary(admin, 'pld_screening_api');

    const res = await request(app).post('/api/v1/pld/triagem').set('Authorization', `Bearer ${key}`).send({ nome: 'Empresa Qualquer Ltda' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('flagged');
    expect(res.body).toHaveProperty('match');

    const after = await addonSummary(admin, 'pld_screening_api');
    expect(after.count).toBe(before.count + 1);

    const forbidden = await request(app).get('/api/v1/sacados/12.345.678%2F0001-90/score').set('Authorization', `Bearer ${key}`);
    expect(forbidden.status).toBe(403);
  });
});

describe('Feature — Registro API (compliance-as-a-service)', () => {
  it('bills a narrow registro_api key per call, restricts it to the registro endpoint only, and returns a real registro number', async () => {
    const { token } = await registerCedente(`Cedente Registro ${unique()} Ltda`); // basico plan — narrow products aren't plan-gated
    const key = await generateKey(token, { mode: 'live', scope: 'read_write', product: 'registro_api' });

    const admin = await adminToken();
    const before = await addonSummary(admin, 'registro_api');

    const res = await request(app)
      .post('/api/v1/registro')
      .set('Authorization', `Bearer ${key}`)
      .send({ referenciaExterna: `ext-${unique()}`, sacadoCnpj: '12.345.678/0001-90', valor: 15000, vencimento: '2026-09-10' });
    expect(res.status).toBe(200);
    expect(res.body.registro).toBeTypeOf('string');
    expect(res.body.registradora).toBeTypeOf('string');
    expect(res.body).toHaveProperty('duplicidadeConfirmada');

    const after = await addonSummary(admin, 'registro_api');
    expect(after.count).toBe(before.count + 1);

    // A narrow product key can't reach any other v1 endpoint.
    const forbidden = await request(app).get('/api/v1/sacados/12.345.678%2F0001-90/score').set('Authorization', `Bearer ${key}`);
    expect(forbidden.status).toBe(403);
  });

  it('never double-bills a full platform key for the same registration, and rejects an invalid payload', async () => {
    const { token } = await registerCedente(`Cedente Registro Platform ${unique()} Ltda`, 'empresarial');
    const key = await generateKey(token, { mode: 'live', scope: 'read_write', product: 'platform' });

    const admin = await adminToken();
    const before = await addonSummary(admin, 'registro_api');
    const res = await request(app)
      .post('/api/v1/registro')
      .set('Authorization', `Bearer ${key}`)
      .send({ referenciaExterna: `ext-${unique()}`, sacadoCnpj: '12.345.678/0001-90', valor: 15000, vencimento: '2026-09-10' });
    expect(res.status).toBe(200);
    const after = await addonSummary(admin, 'registro_api');
    expect(after.count).toBe(before.count);

    const invalid = await request(app).post('/api/v1/registro').set('Authorization', `Bearer ${key}`).send({ referenciaExterna: 'x' });
    expect(invalid.status).toBe(400);
  });
});

describe('Feature 4 — White-label licensing expansion (White-label Plus)', () => {
  it('requires a brand and the Empresarial plan, extends branding to the sacado aceite view, and bills monthly', async () => {
    const sacadoNome = `Fornecedor Whitelabel ${unique()} Ltda`;
    const { token: cedenteToken } = await registerCedente(`Cedente Whitelabel ${unique()} Ltda`, 'empresarial');
    const sacadoToken = await registerSacado(sacadoNome);

    // 402 before the brand exists.
    const denied = await request(app).post('/api/erp/whitelabel/plus').set('Authorization', `Bearer ${cedenteToken}`).send({ enabled: true });
    expect(denied.status).toBe(409);
    expect(denied.body.error).toBe('brand_required');

    await request(app)
      .post('/api/erp/whitelabel/brand')
      .set('Authorization', `Bearer ${cedenteToken}`)
      .send({ nome: 'Marca Teste', corPrimaria: '#1E5EFF', logoUrl: 'https://example.com/logo.png' });

    const { duplicataId } = await submitEmitir(cedenteToken, sacadoNome);
    expect(duplicataId).toBeTruthy();

    const beforePlus = await request(app).get('/api/aceites').set('Authorization', `Bearer ${sacadoToken}`);
    expect(beforePlus.status).toBe(200);
    const aceiteBefore = beforePlus.body.aceites.find((a: { duplicataId: string }) => a.duplicataId === duplicataId);
    expect(aceiteBefore.brandLabel).toBeNull();

    const enable = await request(app).post('/api/erp/whitelabel/plus').set('Authorization', `Bearer ${cedenteToken}`).send({ enabled: true });
    expect(enable.status).toBe(200);
    expect(enable.body.whitelabelPlusEnabled).toBe(true);

    const afterPlus = await request(app).get('/api/aceites').set('Authorization', `Bearer ${sacadoToken}`);
    const aceiteAfter = afterPlus.body.aceites.find((a: { duplicataId: string }) => a.duplicataId === duplicataId);
    expect(aceiteAfter.brandLabel).toBe('Marca Teste');

    const admin = await adminToken();
    const before = await addonSummary(admin, 'whitelabel_plus');
    const run = await request(app).post('/api/admin/whitelabel-plus/cobrar').set('Authorization', `Bearer ${admin}`).send({ period: currentMonthKey() });
    expect(run.status).toBe(200);
    expect(run.body.charged).toBeGreaterThanOrEqual(1);
    const after = await addonSummary(admin, 'whitelabel_plus');
    expect(after.count).toBeGreaterThan(before.count);
  });
});

describe('White-label com domínio próprio', () => {
  it('requires a brand before accepting a domain, rejects a malformed domain, and resolves the brand publicly by Host header once White-label Plus is on', async () => {
    const domain = `creditos-${unique()}.example.com`;
    const { token } = await registerCedente(`Cedente Domínio ${unique()} Ltda`, 'empresarial');

    // No brand yet.
    const denied = await request(app).post('/api/erp/whitelabel/domain').set('Authorization', `Bearer ${token}`).send({ domain });
    expect(denied.status).toBe(409);
    expect(denied.body.error).toBe('brand_required');

    await request(app)
      .post('/api/erp/whitelabel/brand')
      .set('Authorization', `Bearer ${token}`)
      .send({ nome: 'Marca Domínio', corPrimaria: '#1E5EFF', logoUrl: 'https://example.com/logo.png' });

    const invalid = await request(app).post('/api/erp/whitelabel/domain').set('Authorization', `Bearer ${token}`).send({ domain: 'não é um domínio' });
    expect(invalid.status).toBe(400);

    // Brand exists but White-label Plus isn't on yet — GET /public/brand stays null.
    const set = await request(app).post('/api/erp/whitelabel/domain').set('Authorization', `Bearer ${token}`).send({ domain });
    expect(set.status).toBe(200);
    expect(set.body.whitelabelCustomDomain).toBe(domain);
    const beforePlus = await request(app).get('/api/public/brand').set('Host', domain);
    expect(beforePlus.body.brand).toBeNull();

    await request(app).post('/api/erp/whitelabel/plus').set('Authorization', `Bearer ${token}`).send({ enabled: true });

    const resolved = await request(app).get('/api/public/brand').set('Host', domain);
    expect(resolved.status).toBe(200);
    expect(resolved.body.brand).toEqual({ nome: 'Marca Domínio', corPrimaria: '#1E5EFF', logoUrl: 'https://example.com/logo.png' });

    // A host with a port, or an unrelated/default host, never resolves to someone else's brand.
    const withPort = await request(app).get('/api/public/brand').set('Host', `${domain}:4000`);
    expect(withPort.body.brand).toEqual({ nome: 'Marca Domínio', corPrimaria: '#1E5EFF', logoUrl: 'https://example.com/logo.png' });
    const unrelated = await request(app).get('/api/public/brand').set('Host', 'app.lastro.demo');
    expect(unrelated.body.brand).toBeNull();
  });

  it('rejects a domain already claimed by another Empresarial account', async () => {
    const domain = `dup-${unique()}.example.com`;
    const { token: token1 } = await registerCedente(`Cedente Domínio A ${unique()} Ltda`, 'empresarial');
    await request(app)
      .post('/api/erp/whitelabel/brand')
      .set('Authorization', `Bearer ${token1}`)
      .send({ nome: 'A', corPrimaria: '#1E5EFF', logoUrl: 'https://example.com/a.png' });
    await request(app).post('/api/erp/whitelabel/domain').set('Authorization', `Bearer ${token1}`).send({ domain });

    const { token: token2 } = await registerCedente(`Cedente Domínio B ${unique()} Ltda`, 'empresarial');
    await request(app)
      .post('/api/erp/whitelabel/brand')
      .set('Authorization', `Bearer ${token2}`)
      .send({ nome: 'B', corPrimaria: '#0A5C36', logoUrl: 'https://example.com/b.png' });
    const clash = await request(app).post('/api/erp/whitelabel/domain').set('Authorization', `Bearer ${token2}`).send({ domain });
    expect(clash.status).toBe(409);
    expect(clash.body.error).toBe('domain_taken');
  });

  it('removes the domain', async () => {
    const domain = `remove-${unique()}.example.com`;
    const { token } = await registerCedente(`Cedente Domínio Remove ${unique()} Ltda`, 'empresarial');
    await request(app)
      .post('/api/erp/whitelabel/brand')
      .set('Authorization', `Bearer ${token}`)
      .send({ nome: 'C', corPrimaria: '#1E5EFF', logoUrl: 'https://example.com/c.png' });
    await request(app).post('/api/erp/whitelabel/domain').set('Authorization', `Bearer ${token}`).send({ domain });

    const removed = await request(app).post('/api/erp/whitelabel/domain/remove').set('Authorization', `Bearer ${token}`);
    expect(removed.status).toBe(200);
    expect(removed.body.whitelabelCustomDomain).toBeNull();
  });
});

describe('Feature 5 — Institutional analytics/reporting subscription', () => {
  it('requires the Pro plan, gates analytics/report behind the subscription, and bills monthly', async () => {
    const basicoToken = await registerInvestidor('basico');
    const statusBasico = await request(app).get('/api/historico/institutional/status').set('Authorization', `Bearer ${basicoToken}`);
    expect(statusBasico.status).toBe(200);
    expect(statusBasico.body.planOk).toBe(false);

    const deniedSub = await request(app).post('/api/historico/institutional/assinar').set('Authorization', `Bearer ${basicoToken}`).send({ enabled: true });
    expect(deniedSub.status).toBe(402);

    const proToken = await registerInvestidor('pro');
    const statusPro = await request(app).get('/api/historico/institutional/status').set('Authorization', `Bearer ${proToken}`);
    expect(statusPro.body.planOk).toBe(true);
    expect(statusPro.body.enabled).toBe(false);

    const deniedAnalytics = await request(app).get('/api/historico/institutional/analytics').set('Authorization', `Bearer ${proToken}`);
    expect(deniedAnalytics.status).toBe(402);
    expect(deniedAnalytics.body.error).toBe('subscription_required');

    const subscribe = await request(app).post('/api/historico/institutional/assinar').set('Authorization', `Bearer ${proToken}`).send({ enabled: true });
    expect(subscribe.status).toBe(200);
    expect(subscribe.body.enabled).toBe(true);

    const analytics = await request(app).get('/api/historico/institutional/analytics').set('Authorization', `Bearer ${proToken}`);
    expect(analytics.status).toBe(200);
    expect(analytics.body).toHaveProperty('ratingDistribution');
    expect(analytics.body).toHaveProperty('maioresExposicoes');
    expect(Array.isArray(analytics.body.ratingDistribution)).toBe(true);

    const report = await request(app).get('/api/historico/institutional/report.pdf').set('Authorization', `Bearer ${proToken}`);
    expect(report.status).toBe(200);
    expect(report.headers['content-type']).toContain('application/pdf');

    const admin = await adminToken();
    const before = await addonSummary(admin, 'institutional_reporting');
    const run = await request(app)
      .post('/api/admin/institutional-reporting/cobrar')
      .set('Authorization', `Bearer ${admin}`)
      .send({ period: currentMonthKey() });
    expect(run.status).toBe(200);
    expect(run.body.charged).toBeGreaterThanOrEqual(1);
    const after = await addonSummary(admin, 'institutional_reporting');
    expect(after.count).toBeGreaterThan(before.count);
  });
});

describe('Admin add-on pricing config', () => {
  it('lets an admin read and update per-kind add-on pricing', async () => {
    const admin = await adminToken();
    const list = await request(app).get('/api/admin/addons/precos').set('Authorization', `Bearer ${admin}`);
    expect(list.status).toBe(200);
    expect(list.body.precos.length).toBe(13);

    const update = await request(app).put('/api/admin/addons/precos').set('Authorization', `Bearer ${admin}`).send({ kind: 'score_api', preco: 2.5 });
    expect(update.status).toBe(200);
    expect(update.body.preco).toBe(2.5);

    // Restore the default so other tests in this file (score_api pricing shown via /dev) stay stable.
    await request(app).put('/api/admin/addons/precos').set('Authorization', `Bearer ${admin}`).send({ kind: 'score_api', preco: 1.5 });
  });

  it('denies non-admin access', async () => {
    const { token } = await registerCedente(`Cedente Sem Acesso ${unique()} Ltda`);
    const res = await request(app).get('/api/admin/addons/precos').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});
