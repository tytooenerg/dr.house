import { describe, expect, it, beforeAll } from 'vitest';
import { seedIfEmpty } from '../src/db/seed.js';
import { runCobrancaAgentScan } from '../src/lib/cobrancaAgentJob.js';
import { notifyAdmins, listNotifications } from '../src/db/misc.js';
import { getUserByEmail } from '../src/db/users.js';

beforeAll(async () => {
  await seedIfEmpty();
});

describe('cobrança agent background job', () => {
  it('is an honest no-op without ANTHROPIC_API_KEY (no test env sets one) — never fakes a scan', async () => {
    const result = await runCobrancaAgentScan();
    expect(result).toEqual({ scanned: 0, newPendingActions: 0 });
  });
});

describe('notifyAdmins', () => {
  it('fans a notification out to every admin account', async () => {
    const admin = getUserByEmail('admin@lastro.demo')!;
    notifyAdmins('teste de notificação para admins', '#8A5A00');
    const notifications = listNotifications(admin.id, 5);
    expect(notifications.some((n: { text: string }) => n.text === 'teste de notificação para admins')).toBe(true);
  });
});
