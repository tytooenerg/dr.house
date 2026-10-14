import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';

// demoAccountsAvailable tells LoginPage whether to show the "contas de demonstração" hint
// — it must reflect whether cedente@lastro.demo actually exists, not show unconditionally
// (a real customer-facing deployment with SEED_DEMO_DATA unset never seeds it, so the hint
// would otherwise advertise a login that doesn't work there).
describe('GET /api/public/brand', () => {
  beforeAll(async () => {
    await seedIfEmpty();
  });

  it('reports demoAccountsAvailable: true when the demo dataset was seeded (test env always seeds it)', async () => {
    const res = await request(app).get('/api/public/brand');
    expect(res.status).toBe(200);
    expect(res.body.demoAccountsAvailable).toBe(true);
    expect(res.body.brand).toBe(null);
  });
});
