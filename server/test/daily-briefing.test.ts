import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { submitKybForReview } from '../src/db/users.js';
import { buildDailyBriefing, peekDailyBriefing, runDailyBriefing } from '../src/lib/dailyBriefing.js';

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

describe('daily briefing — a prioritized summary of every admin queue, not a decision-maker', () => {
  it('counts a real pending KYB case, and never fabricates a count for an empty queue', async () => {
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ nome: 'Briefing Tester', email: `briefing-${unique()}@example.com`, password: 'senha123', companyName: `Fundo ${unique()}`, role: 'investidor' });
    submitKybForReview(reg.body.user.id);

    const briefing = buildDailyBriefing();
    const kybItem = briefing.items.find((i) => i.label.includes('KYB'));
    expect(kybItem).toBeTruthy();
    expect(kybItem!.count).toBeGreaterThan(0);
    expect(briefing.totalPendente).toBeGreaterThanOrEqual(kybItem!.count);
    // Every item present has a real count > 0 — the empty-queue filter never leaves a
    // zero-count row that would misleadingly claim something needs attention.
    for (const item of briefing.items) expect(item.count).toBeGreaterThan(0);
  });

  it('peekDailyBriefing() never sends a notification or email — read-only', async () => {
    const tok = await adminToken();
    const before = await request(app).get('/api/notifications').set('Authorization', `Bearer ${tok}`);
    const beforeCount = before.body.notifications.length;

    peekDailyBriefing();
    peekDailyBriefing();

    const after = await request(app).get('/api/notifications').set('Authorization', `Bearer ${tok}`);
    expect(after.body.notifications.length).toBe(beforeCount);
  });

  it('runDailyBriefing() notifies every admin in-app when there is something pending', async () => {
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ nome: 'Briefing Run Tester', email: `briefing-run-${unique()}@example.com`, password: 'senha123', companyName: `Fundo ${unique()}`, role: 'investidor' });
    submitKybForReview(reg.body.user.id);

    const tok = await adminToken();
    const before = await request(app).get('/api/notifications').set('Authorization', `Bearer ${tok}`);
    const beforeCount = before.body.notifications.length;

    const result = await runDailyBriefing();
    expect(result.items.length).toBeGreaterThan(0);

    const after = await request(app).get('/api/notifications').set('Authorization', `Bearer ${tok}`);
    expect(after.body.notifications.length).toBeGreaterThan(beforeCount);
    expect(after.body.notifications[0].text).toMatch(/[Rr]esumo di[aá]rio/);
  });

  it('GET /admin/daily-briefing requires an admin', async () => {
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ nome: 'Not Admin', email: `not-admin-${unique()}@example.com`, password: 'senha123', companyName: `Fundo ${unique()}`, role: 'investidor' });
    const res = await request(app).get('/api/admin/daily-briefing').set('Authorization', `Bearer ${reg.body.token}`);
    expect(res.status).toBe(403);
  });

  it('GET /admin/daily-briefing returns the same shape as peekDailyBriefing()', async () => {
    const tok = await adminToken();
    const res = await request(app).get('/api/admin/daily-briefing').set('Authorization', `Bearer ${tok}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(typeof res.body.totalPendente).toBe('number');
    expect(typeof res.body.geradoEm).toBe('string');
  });
});
