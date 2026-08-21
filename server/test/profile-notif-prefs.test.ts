import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { db } from '../src/db/index.js';
import { seedIfEmpty } from '../src/db/seed.js';

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function adminToken() {
  const res = await request(app).post('/api/auth/login').send({ email: 'admin@lastro.demo', password: 'demo1234' });
  return { token: res.body.token as string, userId: res.body.user.id as number };
}

async function registerCedente() {
  const email = `cedente-${unique()}@example.com`;
  const reg = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Notif Tester', email, password: 'senha123', companyName: `Cedente ${unique()}`, role: 'cedente' });
  return { token: reg.body.token as string, userId: reg.body.user.id as number };
}

// lib/dailyBriefing.ts's runDailyBriefing() checks notifPrefs.digest to decide whether an
// admin should get the daily-digest email — this is the wiring that actually lets an admin
// flip that switch (POST /profile/notif-pref → PerfilPage.tsx's "Resumo diário do
// back-office" toggle, admin-only since digest means nothing for any other role).
describe('notifPrefs.digest — opt-out for the daily briefing email', () => {
  it('defaults to true for every role, cedente included, even though only admin sees a toggle for it', async () => {
    const admin = await adminToken();
    const cedente = await registerCedente();

    const adminProfile = await request(app).get('/api/profile').set('Authorization', `Bearer ${admin.token}`);
    expect(adminProfile.body.notifPrefs.digest).toBe(true);

    const cedenteProfile = await request(app).get('/api/profile').set('Authorization', `Bearer ${cedente.token}`);
    expect(cedenteProfile.body.notifPrefs.digest).toBe(true);
  });

  it('POST /profile/notif-pref { key: "digest" } toggles it off, then back on', async () => {
    const { token } = await registerCedente();

    const off = await request(app).post('/api/profile/notif-pref').set('Authorization', `Bearer ${token}`).send({ key: 'digest' });
    expect(off.status).toBe(200);
    expect(off.body.notifPrefs.digest).toBe(false);

    const check = await request(app).get('/api/profile').set('Authorization', `Bearer ${token}`);
    expect(check.body.notifPrefs.digest).toBe(false);

    const on = await request(app).post('/api/profile/notif-pref').set('Authorization', `Bearer ${token}`).send({ key: 'digest' });
    expect(on.body.notifPrefs.digest).toBe(true);
  });

  it('getSettings() deep-merges notifPrefs — an account whose stored settings predate the digest key still gets the real default, not undefined', async () => {
    const { token, userId } = await registerCedente();

    // Simulate a pre-existing account: overwrite the stored settings JSON with a notifPrefs
    // object saved before `digest` existed (exactly db/types.ts's old shape), the way a
    // real account created before this change would have on disk.
    const row = db.prepare('SELECT settings FROM users WHERE id = ?').get(userId) as { settings: string };
    const stale = JSON.parse(row.settings);
    stale.notifPrefs = { leilao: true, aceite: true, disputa: true, marketing: false };
    db.prepare('UPDATE users SET settings = ? WHERE id = ?').run(JSON.stringify(stale), userId);

    const res = await request(app).get('/api/profile').set('Authorization', `Bearer ${token}`);
    expect(res.body.notifPrefs.digest).toBe(true);
    // The rest of notifPrefs is untouched — this isn't a full reset back to defaults.
    expect(res.body.notifPrefs.marketing).toBe(false);
  });
});
