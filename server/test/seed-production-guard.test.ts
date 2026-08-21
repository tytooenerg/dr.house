import { describe, expect, it, afterAll } from 'vitest';
import { db } from '../src/db/index.js';
import { seedIfEmpty } from '../src/db/seed.js';

function userCount(): number {
  return (db.prepare('SELECT COUNT(*) as n FROM users').get() as { n: number }).n;
}

const originalNodeEnv = process.env.NODE_ENV;

// A publicly-documented demo admin account (admin@lastro.demo / demo1234 — see README) is
// fine for local/dev/staging but a real vulnerability on an internet-facing production
// deployment with an empty database. Runs in its own isolated in-memory DB (a fresh module
// registry per Vitest test file), so the assertion that the users table starts empty is
// real, not incidental to test ordering.
describe('seedIfEmpty production guard — no publicly-documented demo accounts on a real deploy', () => {
  afterAll(() => {
    process.env.NODE_ENV = originalNodeEnv;
    delete process.env.SEED_DEMO_DATA;
  });

  it('skips seeding when NODE_ENV=production and SEED_DEMO_DATA is unset', async () => {
    expect(userCount()).toBe(0);
    process.env.NODE_ENV = 'production';
    delete process.env.SEED_DEMO_DATA;
    await seedIfEmpty();
    expect(userCount()).toBe(0);
  });

  it('still seeds when NODE_ENV=production and SEED_DEMO_DATA=true (explicit opt-in)', async () => {
    expect(userCount()).toBe(0);
    process.env.NODE_ENV = 'production';
    process.env.SEED_DEMO_DATA = 'true';
    await seedIfEmpty();
    expect(userCount()).toBeGreaterThan(0);
    expect(db.prepare("SELECT id FROM users WHERE email = 'admin@lastro.demo'").get()).toBeTruthy();
  });
});
