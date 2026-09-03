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

async function registerAnunciante(companyName = `Anunciante ${unique()}`) {
  const email = `anunciante-${unique()}@example.com`;
  const res = await request(app).post('/api/auth/register').send({ nome: 'Dono Anúncio', email, password: 'senha123', companyName, role: 'anunciante' });
  return { token: res.body.token as string, userId: res.body.user.id as number, user: res.body.user };
}

async function registerCedente() {
  const email = `ced-ads-${unique()}@example.com`;
  const res = await request(app).post('/api/auth/register').send({ nome: 'Cedente', email, password: 'senha123', companyName: `Cedente ${unique()}`, role: 'cedente' });
  return res.body.token as string;
}

const VALID_AD = { logoUrl: 'https://example.com/logo.png', titulo: 'Anuncie aqui', texto: 'Uma frase curta sobre o produto.', linkUrl: 'https://example.com' };

async function addonSummary(token: string, kind: string) {
  const res = await request(app).get('/api/admin/addons/cobrancas').set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  return (res.body.resumo as { kind: string; totalFmt: string; count: number }[]).find((r) => r.kind === kind)!;
}

describe('Carrossel de publicidade — cadastro do papel anunciante', () => {
  it('registra sem exigir KYB e cai na aba publicidade', async () => {
    const res = await request(app).post('/api/auth/register').send({
      nome: 'Dono Anúncio',
      email: `anunciante-onboarding-${unique()}@example.com`,
      password: 'senha123',
      companyName: `Empresa ${unique()}`,
      role: 'anunciante',
    });
    expect(res.status).toBe(201);
    expect(res.body.user.needsKyb).toBe(false);
    expect(res.body.user.navTabs).toContain('publicidade');
    expect(res.body.user.navTabs).not.toContain('assinatura');
  });
});

describe('Carrossel de publicidade — self-service (routes/advertisements.ts)', () => {
  it('só uma conta anunciante acessa /advertisements/me', async () => {
    const cedenteToken = await registerCedente();
    const res = await request(app).get('/api/advertisements/me').set('Authorization', `Bearer ${cedenteToken}`);
    expect(res.status).toBe(403);
  });

  it('sem anúncio ainda, GET /me retorna ad:null e o preço mensal', async () => {
    const { token } = await registerAnunciante();
    const res = await request(app).get('/api/advertisements/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.ad).toBeNull();
    expect(res.body.precoMensalFmt).toBeTruthy();
  });

  it('rejeita um anúncio com URL inválida', async () => {
    const { token } = await registerAnunciante();
    const res = await request(app).post('/api/advertisements/me').set('Authorization', `Bearer ${token}`).send({ ...VALID_AD, logoUrl: 'não é url' });
    expect(res.status).toBe(400);
  });

  it('cria o anúncio como pendente, e uma edição depois de aprovado volta pra pendente', async () => {
    const companyName = `Cria E Edita ${unique()}`;
    const { token } = await registerAnunciante(companyName);
    const create = await request(app).post('/api/advertisements/me').set('Authorization', `Bearer ${token}`).send(VALID_AD);
    expect(create.status).toBe(200);
    expect(create.body.ad.status).toBe('pendente');

    const admin = await adminToken();
    const pending = await request(app).get('/api/admin/advertisements').set('Authorization', `Bearer ${admin}`);
    const mine = pending.body.pending.find((p: { empresa: string }) => p.empresa === companyName);
    expect(mine).toBeTruthy();
    await request(app).post(`/api/admin/advertisements/${mine.id}/decidir`).set('Authorization', `Bearer ${admin}`).send({ decision: 'aprovado' });

    const afterApproval = await request(app).get('/api/advertisements/me').set('Authorization', `Bearer ${token}`);
    expect(afterApproval.body.ad.status).toBe('aprovado');

    const edit = await request(app).post('/api/advertisements/me').set('Authorization', `Bearer ${token}`).send({ ...VALID_AD, titulo: 'Novo título' });
    expect(edit.body.ad.status).toBe('pendente');
  });

  it('toggle exige um anúncio já existente', async () => {
    const { token } = await registerAnunciante();
    const res = await request(app).post('/api/advertisements/me/toggle').set('Authorization', `Bearer ${token}`).send({ ativo: false });
    expect(res.status).toBe(404);
  });

  it('toggle liga/desliga o anúncio do próprio anunciante', async () => {
    const { token } = await registerAnunciante();
    await request(app).post('/api/advertisements/me').set('Authorization', `Bearer ${token}`).send(VALID_AD);
    const off = await request(app).post('/api/advertisements/me/toggle').set('Authorization', `Bearer ${token}`).send({ ativo: false });
    expect(off.body.ad.ativo).toBe(false);
    const on = await request(app).post('/api/advertisements/me/toggle').set('Authorization', `Bearer ${token}`).send({ ativo: true });
    expect(on.body.ad.ativo).toBe(true);
  });
});

describe('Carrossel de publicidade — moderação (routes/admin.ts)', () => {
  it('não-admin não acessa a fila', async () => {
    const { token } = await registerAnunciante();
    const res = await request(app).get('/api/admin/advertisements').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('rejeitar exige um motivo, aprovar não', async () => {
    const { token } = await registerAnunciante();
    await request(app).post('/api/advertisements/me').set('Authorization', `Bearer ${token}`).send(VALID_AD);
    const admin = await adminToken();
    const pending = await request(app).get('/api/admin/advertisements').set('Authorization', `Bearer ${admin}`);
    const mine = pending.body.pending.at(-1);

    const noReason = await request(app).post(`/api/admin/advertisements/${mine.id}/decidir`).set('Authorization', `Bearer ${admin}`).send({ decision: 'rejeitado' });
    expect(noReason.status).toBe(400);

    const withReason = await request(app)
      .post(`/api/admin/advertisements/${mine.id}/decidir`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ decision: 'rejeitado', rejectReason: 'Logo em baixa resolução' });
    expect(withReason.status).toBe(200);
  });

  it('a conta anunciante vê o motivo da rejeição em GET /me', async () => {
    const { token } = await registerAnunciante();
    await request(app).post('/api/advertisements/me').set('Authorization', `Bearer ${token}`).send(VALID_AD);
    const admin = await adminToken();
    const pending = await request(app).get('/api/admin/advertisements').set('Authorization', `Bearer ${admin}`);
    const mine = pending.body.pending.at(-1);
    await request(app).post(`/api/admin/advertisements/${mine.id}/decidir`).set('Authorization', `Bearer ${admin}`).send({ decision: 'rejeitado', rejectReason: 'Link quebrado' });

    const me = await request(app).get('/api/advertisements/me').set('Authorization', `Bearer ${token}`);
    expect(me.body.ad.status).toBe('rejeitado');
    expect(me.body.ad.rejectReason).toBe('Link quebrado');
  });

  it('um anúncio já decidido não pode ser decidido de novo', async () => {
    const { token } = await registerAnunciante();
    await request(app).post('/api/advertisements/me').set('Authorization', `Bearer ${token}`).send(VALID_AD);
    const admin = await adminToken();
    const pending = await request(app).get('/api/admin/advertisements').set('Authorization', `Bearer ${admin}`);
    const mine = pending.body.pending.at(-1);
    await request(app).post(`/api/admin/advertisements/${mine.id}/decidir`).set('Authorization', `Bearer ${admin}`).send({ decision: 'aprovado' });

    const again = await request(app).post(`/api/admin/advertisements/${mine.id}/decidir`).set('Authorization', `Bearer ${admin}`).send({ decision: 'aprovado' });
    expect(again.status).toBe(404);
  });

  // Copilot de triagem (lib/adCopilot.ts) — nunca decide sozinho, só sinaliza pro admin
  // revisar antes de aprovar/rejeitar. Sem ANTHROPIC_API_KEY (ambiente de teste), o
  // fallback real-when-configured retorna null em vez de fabricar uma avaliação.
  it('screening da IA retorna null sem ANTHROPIC_API_KEY configurada (real-when-configured)', async () => {
    const { token } = await registerAnunciante();
    await request(app).post('/api/advertisements/me').set('Authorization', `Bearer ${token}`).send(VALID_AD);
    const admin = await adminToken();
    const pending = await request(app).get('/api/admin/advertisements').set('Authorization', `Bearer ${admin}`);
    const mine = pending.body.pending.at(-1);

    const screening = await request(app).get(`/api/admin/advertisements/${mine.id}/ai-screening`).set('Authorization', `Bearer ${admin}`);
    expect(screening.status).toBe(200);
    expect(screening.body.assessment).toBeNull();
  });

  it('screening da IA em anúncio inexistente retorna 404', async () => {
    const admin = await adminToken();
    const res = await request(app).get('/api/admin/advertisements/999999/ai-screening').set('Authorization', `Bearer ${admin}`);
    expect(res.status).toBe(404);
  });

  it('não-admin não acessa o screening', async () => {
    const { token } = await registerAnunciante();
    const res = await request(app).get('/api/admin/advertisements/1/ai-screening').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

describe('Carrossel de publicidade — feed público (routes/public.ts)', () => {
  it('mostra só anúncios aprovados e ativos — nunca pendente, rejeitado ou pausado', async () => {
    const pendenteOnly = await registerAnunciante('Só Pendente Ltda');
    await request(app).post('/api/advertisements/me').set('Authorization', `Bearer ${pendenteOnly.token}`).send({ ...VALID_AD, titulo: 'Só Pendente' });

    const aprovadoAtivo = await registerAnunciante('Aprovado Ativo Ltda');
    await request(app).post('/api/advertisements/me').set('Authorization', `Bearer ${aprovadoAtivo.token}`).send({ ...VALID_AD, titulo: 'Aprovado Ativo' });

    const aprovadoPausado = await registerAnunciante('Aprovado Pausado Ltda');
    await request(app).post('/api/advertisements/me').set('Authorization', `Bearer ${aprovadoPausado.token}`).send({ ...VALID_AD, titulo: 'Aprovado Pausado' });

    const admin = await adminToken();
    const pending = await request(app).get('/api/admin/advertisements').set('Authorization', `Bearer ${admin}`);
    for (const p of pending.body.pending) {
      if (p.titulo === 'Aprovado Ativo' || p.titulo === 'Aprovado Pausado') {
        await request(app).post(`/api/admin/advertisements/${p.id}/decidir`).set('Authorization', `Bearer ${admin}`).send({ decision: 'aprovado' });
      }
    }
    await request(app).post('/api/advertisements/me/toggle').set('Authorization', `Bearer ${aprovadoPausado.token}`).send({ ativo: false });

    const feed = await request(app).get('/api/public/advertisements');
    expect(feed.status).toBe(200);
    const titulos = feed.body.ads.map((a: { titulo: string }) => a.titulo);
    expect(titulos).toContain('Aprovado Ativo');
    expect(titulos).not.toContain('Só Pendente');
    expect(titulos).not.toContain('Aprovado Pausado');
  });

  it('o admin pode desligar o carrossel inteiro via feature flag, sem mexer nos anúncios', async () => {
    const admin = await adminToken();
    const off = await request(app).post('/api/admin/feature-flags/ad_carousel').set('Authorization', `Bearer ${admin}`).send({ enabled: false, rolloutPct: 100 });
    expect(off.status).toBe(200);

    const feed = await request(app).get('/api/public/advertisements');
    expect(feed.body.ads).toEqual([]);

    await request(app).post('/api/admin/feature-flags/ad_carousel').set('Authorization', `Bearer ${admin}`).send({ enabled: true, rolloutPct: 100 });
  });
});

describe('Carrossel de publicidade — cobrança mensal (lib/advertisementBilling.ts)', () => {
  it('cobra só quem está aprovado e ativo, e não cobra duas vezes no mesmo período', async () => {
    const { token } = await registerAnunciante('Cobrança Ltda');
    await request(app).post('/api/advertisements/me').set('Authorization', `Bearer ${token}`).send(VALID_AD);

    const admin = await adminToken();
    const pending = await request(app).get('/api/admin/advertisements').set('Authorization', `Bearer ${admin}`);
    const mine = pending.body.pending.find((p: { empresa: string }) => p.empresa === 'Cobrança Ltda');
    await request(app).post(`/api/admin/advertisements/${mine.id}/decidir`).set('Authorization', `Bearer ${admin}`).send({ decision: 'aprovado' });

    const before = await addonSummary(admin, 'publicidade_carrossel');
    const period = currentMonthKey();
    const run1 = await request(app).post('/api/admin/advertisements/cobrar').set('Authorization', `Bearer ${admin}`).send({ period });
    expect(run1.status).toBe(200);
    expect(run1.body.charged).toBeGreaterThanOrEqual(1);
    const after = await addonSummary(admin, 'publicidade_carrossel');
    expect(after.count).toBeGreaterThan(before.count);

    const run2 = await request(app).post('/api/admin/advertisements/cobrar').set('Authorization', `Bearer ${admin}`).send({ period });
    expect(run2.body.charged).toBe(0); // já cobrado neste período — chargeOncePerPeriod é idempotente
  });
});
