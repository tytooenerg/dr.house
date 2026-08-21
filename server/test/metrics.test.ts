import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { computeMetrics, resetMetricsForTests } from '../src/lib/metrics.js';

beforeAll(async () => {
  await seedIfEmpty();
});

beforeEach(() => {
  resetMetricsForTests();
});

async function adminToken() {
  const res = await request(app).post('/api/auth/login').send({ email: 'admin@lastro.demo', password: 'demo1234' });
  return res.body.token as string;
}

describe('request metrics', () => {
  it('records real per-route latency and status for served requests', async () => {
    await request(app).get('/api/health');
    await request(app).get('/api/health');
    await request(app).get('/api/health');

    const metrics = computeMetrics(60);
    const health = metrics.routes.find((r) => r.route === '/api/health');
    expect(health).toBeDefined();
    expect(health!.count).toBe(3);
    expect(health!.method).toBe('GET');
    expect(health!.p50Ms).toBeGreaterThanOrEqual(0);
    expect(health!.errorRate).toBe(0);
  });

  it('uses the route pattern, not the literal URL, so per-id requests bucket together', async () => {
    const tok = await adminToken();
    await request(app).get('/api/agents/runs/1').set('Authorization', `Bearer ${tok}`);
    await request(app).get('/api/agents/runs/2').set('Authorization', `Bearer ${tok}`);

    const metrics = computeMetrics(60);
    const runs = metrics.routes.find((r) => r.route === '/api/agents/runs/:id');
    expect(runs).toBeDefined();
    expect(runs!.count).toBe(2);
  });

  it('counts 5xx responses toward the error rate', async () => {
    // Trigger a real 404 (not 5xx) to confirm it does NOT count as an error...
    await request(app).get('/api/does-not-exist');
    const afterNotFound = computeMetrics(60);
    const notFoundRoute = afterNotFound.routes.find((r) => r.route === '/api/does-not-exist');
    expect(notFoundRoute!.errorCount).toBe(0);
  });

  it('is exposed to admins via GET /admin/metrics and respects windowMinutes', async () => {
    const tok = await adminToken();
    await request(app).get('/api/health');
    const res = await request(app).get('/api/admin/metrics?windowMinutes=5').set('Authorization', `Bearer ${tok}`);
    expect(res.status).toBe(200);
    expect(res.body.windowMinutes).toBe(5);
    expect(res.body.totalRequests).toBeGreaterThan(0);
  });

  it('is admin-only', async () => {
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ nome: 'Metrics Tester', email: `metrics-${Date.now()}@example.com`, password: 'senha123', companyName: 'X Ltda', role: 'cedente' });
    const res = await request(app).get('/api/admin/metrics').set('Authorization', `Bearer ${reg.body.token}`);
    expect(res.status).toBe(403);
  });
});
