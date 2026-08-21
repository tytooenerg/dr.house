import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { runMonthlyRegulatoryReports } from '../src/lib/monthlyRegulatoryReportsJob.js';
import { getPlatformSetting } from '../src/db/platformSettings.js';

beforeAll(async () => {
  await seedIfEmpty();
});

async function adminToken() {
  const res = await request(app).post('/api/auth/login').send({ email: 'admin@lastro.demo', password: 'demo1234' });
  return res.body.token as string;
}

// The CVM informe and DARF PDFs themselves (lib/regulatoryReports.ts, lib/darfGenerator.ts)
// are already real and separately tested — this only tests the new part: turning "an admin
// has to remember to click download, twice, every month" into an automatic email with both
// PDFs attached, exactly once per closed month.
describe('runMonthlyRegulatoryReports — CVM + DARF emailed automatically', () => {
  it('sends once for the previous month and records the period so it never double-sends', async () => {
    const first = await runMonthlyRegulatoryReports();
    expect(first.sent).toBe(true);
    expect(first.period).toMatch(/^\d{4}-\d{2}$/);
    expect(getPlatformSetting('monthly_regulatory_reports_last_period')).toBe(first.period);

    const second = await runMonthlyRegulatoryReports();
    expect(second.sent).toBe(false);
    expect(second.period).toBe(first.period);
  });

  it('the period reported is genuinely the previous calendar month, not the current one', async () => {
    const result = await runMonthlyRegulatoryReports();
    const now = new Date();
    const expectedPrev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const expected = `${expectedPrev.getFullYear()}-${String(expectedPrev.getMonth() + 1).padStart(2, '0')}`;
    expect(result.period).toBe(expected);
  });
});

// The admin-facing CVM/DARF download endpoints (already existing, unmodified) still work
// exactly as before — this batch only adds an automatic path alongside them, never replaces
// the manual one.
describe('CVM/DARF manual download endpoints are unaffected', () => {
  it('still serve a real PDF on demand', async () => {
    const tok = await adminToken();
    const cvm = await request(app).get('/api/admin/regulatorio/cvm-informe.pdf').set('Authorization', `Bearer ${tok}`);
    expect(cvm.status).toBe(200);
    expect(cvm.headers['content-type']).toBe('application/pdf');

    const darf = await request(app).get('/api/admin/juridico/darf.pdf').set('Authorization', `Bearer ${tok}`);
    expect(darf.status).toBe(200);
    expect(darf.headers['content-type']).toBe('application/pdf');
  });
});
