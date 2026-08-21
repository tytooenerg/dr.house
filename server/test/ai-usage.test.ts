import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { recordClaudeUsage, estimateCostUsd } from '../src/db/claudeUsage.js';

beforeAll(async () => {
  await seedIfEmpty();
});

async function adminToken() {
  const res = await request(app).post('/api/auth/login').send({ email: 'admin@lastro.demo', password: 'demo1234' });
  return res.body.token as string;
}

async function cedenteToken() {
  const res = await request(app).post('/api/auth/register').send({
    nome: 'Cedente Teste',
    email: `ced-ai-usage-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`,
    password: 'senha123',
    companyName: 'Fornecedora AI Usage Ltda',
    role: 'cedente',
  });
  return res.body.token as string;
}

describe('Claude usage/cost metering', () => {
  it('estimates cost proportionally to input/output tokens', () => {
    expect(estimateCostUsd(0, 0)).toBe(0);
    const cost = estimateCostUsd(1_000_000, 1_000_000);
    // Default rates (overridable via env) are $3/MTok in, $15/MTok out.
    expect(cost).toBeCloseTo(18, 5);
  });

  it('aggregates recorded usage by feature for the admin panel', async () => {
    recordClaudeUsage({ feature: 'test_feature_a', userId: null, inputTokens: 1000, outputTokens: 500, ok: true });
    recordClaudeUsage({ feature: 'test_feature_a', userId: null, inputTokens: 2000, outputTokens: 1000, ok: true });
    recordClaudeUsage({ feature: 'test_feature_b', userId: null, inputTokens: 100, outputTokens: 50, ok: false });

    const admin = await adminToken();
    const res = await request(app).get('/api/admin/ai-usage').set('Authorization', `Bearer ${admin}`);
    expect(res.status).toBe(200);
    expect(res.body.totalCalls).toBeGreaterThanOrEqual(3);
    expect(res.body.failedCalls).toBeGreaterThanOrEqual(1);

    const featureA = (res.body.byFeature as { feature: string; calls: number }[]).find((f) => f.feature === 'test_feature_a');
    expect(featureA).toBeTruthy();
    expect(featureA!.calls).toBe(2);
  });

  it('requires admin role for the usage summary', async () => {
    const token = await cedenteToken();
    const res = await request(app).get('/api/admin/ai-usage').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});
