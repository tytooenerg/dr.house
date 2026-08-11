import { describe, expect, it, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { setV1SunsetDate } from '../src/lib/apiVersioning.js';

beforeAll(async () => {
  await seedIfEmpty();
});

// The mechanism is a real global platform_settings row shared across the whole file's
// in-memory DB (same per-file, cumulative-within-file isolation this test suite's other
// files already rely on) — always reset it after each test so one test's sunset date can
// never leak into the next.
afterEach(() => {
  setV1SunsetDate(null);
});

async function adminToken() {
  const res = await request(app).post('/api/auth/login').send({ email: 'admin@lastro.demo', password: 'demo1234' });
  return res.body.token as string;
}

describe('API versioning — real Deprecation/Sunset headers, off by default', () => {
  it('never sends Deprecation/Sunset headers on /v1 when no sunset date is configured', async () => {
    const res = await request(app).get('/api/v1/marketplace').set('Authorization', 'Bearer not-a-real-key');
    expect(res.headers['deprecation']).toBeUndefined();
    expect(res.headers['sunset']).toBeUndefined();
  });

  it('sends real Deprecation/Sunset headers on every /v1 response once an admin configures a sunset date', async () => {
    setV1SunsetDate('2030-01-01T00:00:00.000Z');
    const res = await request(app).get('/api/v1/marketplace').set('Authorization', 'Bearer not-a-real-key');
    expect(res.headers['deprecation']).toBe('true');
    expect(res.headers['sunset']).toBe(new Date('2030-01-01T00:00:00.000Z').toUTCString());
    expect(res.headers['link']).toContain('rel="deprecation"');
  });

  it('the admin API reads and writes the real sunset date, and rejects an invalid date', async () => {
    const admin = await adminToken();

    const before = await request(app).get('/api/admin/api-versioning').set('Authorization', `Bearer ${admin}`);
    expect(before.status).toBe(200);
    expect(before.body.sunsetDate).toBeNull();

    const bad = await request(app).put('/api/admin/api-versioning').set('Authorization', `Bearer ${admin}`).send({ sunsetDate: 'not-a-real-date' });
    expect(bad.status).toBe(400);

    const set = await request(app).put('/api/admin/api-versioning').set('Authorization', `Bearer ${admin}`).send({ sunsetDate: '2031-06-01' });
    expect(set.status).toBe(200);
    expect(set.body.sunsetDate).toBe('2031-06-01');

    const after = await request(app).get('/api/admin/api-versioning').set('Authorization', `Bearer ${admin}`);
    expect(after.body.sunsetDate).toBe('2031-06-01');

    // Immediately reflected on real /v1 traffic — no deploy needed.
    const v1res = await request(app).get('/api/v1/marketplace').set('Authorization', 'Bearer not-a-real-key');
    expect(v1res.headers['deprecation']).toBe('true');

    const cleared = await request(app).put('/api/admin/api-versioning').set('Authorization', `Bearer ${admin}`).send({ sunsetDate: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.sunsetDate).toBeNull();
    const v1resAfterClear = await request(app).get('/api/v1/marketplace').set('Authorization', 'Bearer not-a-real-key');
    expect(v1resAfterClear.headers['deprecation']).toBeUndefined();
  });

  it('requires admin auth', async () => {
    const res = await request(app).get('/api/admin/api-versioning');
    expect(res.status).toBe(401);
  });
});
