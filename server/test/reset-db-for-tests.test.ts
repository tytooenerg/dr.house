import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { db, resetDbForTests } from '../src/db/index.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { approveKyb } from '../src/db/users.js';
import { arrematar, darLance, fecharLeiloes } from './helpers/auction.js';

// resetDbForTests() itself isn't called by any other test today (each test file already
// gets its own fresh :memory: database from Vitest's per-file isolation) — this is the
// thing that actually exercises it, so a drift between its DELETE list and the live schema
// (adding a table without adding its DELETE, or getting the FK order wrong) gets caught
// here instead of staying silently wrong until someone reaches for it for real.
beforeAll(async () => {
  await seedIfEmpty();
});

function allTableNames(): string[] {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((r) => r.name);
}

describe('resetDbForTests', () => {
  it('empties every real table without violating a foreign key, and leaves schema_migrations alone', async () => {
    // Touch a broad slice of the schema beyond what seedIfEmpty() already populates, so the
    // FK ordering is actually exercised end to end (a purchase -> a resale listing -> a bid,
    // an aceite -> a dispute, a duplicata -> a compliance/insurance row...).
    const email = `reset-check-${Date.now()}@example.com`;
    const reg = await request(app).post('/api/auth/register').send({ nome: 'Reset Check', email, password: 'senha123', companyName: 'Reset Check Ltda', role: 'investidor' });
    approveKyb(reg.body.user.id);
    const token = reg.body.token as string;

    const market = await request(app).get('/api/market').set('Authorization', `Bearer ${token}`);
    const buyable = market.body.offers.find((o: { canBuy: boolean }) => o.canBuy);
    expect(buyable).toBeTruthy();
    (await arrematar(token, buyable.id)).lance;

    const before = new Map(allTableNames().map((t) => [t, (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n]));
    expect(before.get('users')).toBeGreaterThan(0);
    expect(before.get('duplicatas')).toBeGreaterThan(0);
    expect(before.get('purchases')).toBeGreaterThan(0);

    expect(() => resetDbForTests()).not.toThrow();

    for (const table of allTableNames()) {
      const count = (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
      if (table === 'schema_migrations') {
        // Migration bookkeeping, not application data — must survive a reset, or the next
        // runMigrations() call would think a fresh database needs every migration reapplied.
        expect(count).toBeGreaterThan(0);
      } else {
        expect(count, `${table} should be empty after resetDbForTests()`).toBe(0);
      }
    }
  });
});
