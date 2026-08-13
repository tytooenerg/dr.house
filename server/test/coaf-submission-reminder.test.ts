import { describe, expect, it, beforeAll } from 'vitest';
import { seedIfEmpty } from '../src/db/seed.js';
import { createUser } from '../src/db/users.js';
import { createSuspiciousActivityReport } from '../src/db/suspiciousActivity.js';
import { db } from '../src/db/index.js';
import { runCoafSubmissionReminder } from '../src/lib/coafSubmissionReminder.js';
import { listNotifications } from '../src/db/misc.js';

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

describe('COAF submission reminder (lib/coafSubmissionReminder.ts)', () => {
  it('does not flag a recently-opened SAR', () => {
    const user = createUser({ email: `coaf-fresh-${unique()}@example.com`, passwordHash: 'x', nome: 'T', companyName: 'Fresh Co', role: 'cedente' });
    createSuspiciousActivityReport({ userId: user.id, tipo: 'fracionamento', severidade: 'atencao', descricao: 'teste', evidencia: {} });

    const before = runCoafSubmissionReminder();
    const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get() as { id: number };
    const notificationsBefore = listNotifications(admin.id, 50).length;

    // Running again immediately shouldn't add a fresh report to the stale count.
    const after = runCoafSubmissionReminder();
    expect(after.stale).toBe(before.stale);
    expect(listNotifications(admin.id, 50).length).toBe(notificationsBefore);
  });

  it('flags and notifies admins about a SAR open for more than the staleness window', () => {
    const user = createUser({ email: `coaf-stale-${unique()}@example.com`, passwordHash: 'x', nome: 'T', companyName: 'Stale Co', role: 'cedente' });
    const report = createSuspiciousActivityReport({ userId: user.id, tipo: 'entrada_saida_rapida', severidade: 'critico', descricao: 'teste antigo', evidencia: {} });
    db.prepare("UPDATE suspicious_activity_reports SET created_at = datetime('now', '-5 days') WHERE id = ?").run(report.id);

    const before = runCoafSubmissionReminder();
    expect(before.stale).toBeGreaterThan(0);

    const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get() as { id: number };
    const notifications = listNotifications(admin.id, 50);
    expect(notifications.some((n) => n.text.includes('SISCOAF'))).toBe(true);
  });
});
