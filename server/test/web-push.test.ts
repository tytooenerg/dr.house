import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { listPushSubscriptionsByUser } from '../src/db/pushSubscriptions.js';
import { sendWebPush, webPushEnabled } from '../src/lib/webPush.js';
import { addNotification } from '../src/db/misc.js';

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function registerInvestidor() {
  const email = `inv-push-${unique()}@example.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Investidor Push', email, password: 'senha123', companyName: `Fundo Push ${unique()}`, role: 'investidor' });
  return { token: res.body.token as string, userId: res.body.user.id as number };
}

describe('Web Push — real-when-configured (VAPID_PUBLIC_KEY/PRIVATE_KEY unset in tests)', () => {
  it('reports disabled and no public key when VAPID is not configured', async () => {
    const { token } = await registerInvestidor();
    const res = await request(app).get('/api/notifications/push/config').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(webPushEnabled);
    expect(res.body.enabled).toBe(false);
    expect(res.body.publicKey).toBeNull();
  });

  it('stores a real subscription and upserts on re-subscribe with the same endpoint', async () => {
    const { token, userId } = await registerInvestidor();
    const endpoint = `https://push.example.com/${unique()}`;
    const first = await request(app)
      .post('/api/notifications/push/subscribe')
      .set('Authorization', `Bearer ${token}`)
      .send({ endpoint, keys: { p256dh: 'p256dh-key-1', auth: 'auth-key-1' } });
    expect(first.status).toBe(200);
    expect(listPushSubscriptionsByUser(userId)).toHaveLength(1);

    const again = await request(app)
      .post('/api/notifications/push/subscribe')
      .set('Authorization', `Bearer ${token}`)
      .send({ endpoint, keys: { p256dh: 'p256dh-key-2', auth: 'auth-key-2' } });
    expect(again.status).toBe(200);
    const subs = listPushSubscriptionsByUser(userId);
    expect(subs).toHaveLength(1); // same endpoint upserts, doesn't duplicate
    expect(subs[0].p256dh).toBe('p256dh-key-2');
  });

  it('removes a subscription on unsubscribe', async () => {
    const { token, userId } = await registerInvestidor();
    const endpoint = `https://push.example.com/${unique()}`;
    await request(app).post('/api/notifications/push/subscribe').set('Authorization', `Bearer ${token}`).send({ endpoint, keys: { p256dh: 'x', auth: 'y' } });
    expect(listPushSubscriptionsByUser(userId)).toHaveLength(1);

    const res = await request(app).post('/api/notifications/push/unsubscribe').set('Authorization', `Bearer ${token}`).send({ endpoint });
    expect(res.status).toBe(200);
    expect(listPushSubscriptionsByUser(userId)).toHaveLength(0);
  });

  it('validates the subscription payload', async () => {
    const { token } = await registerInvestidor();
    const res = await request(app).post('/api/notifications/push/subscribe').set('Authorization', `Bearer ${token}`).send({ endpoint: 'not-a-url' });
    expect(res.status).toBe(400);
  });

  it('sendWebPush is a real no-op with no subscriptions or when unconfigured — never throws', async () => {
    const { userId } = await registerInvestidor();
    await expect(sendWebPush(userId, { title: 'Teste', body: 'corpo' })).resolves.toBeUndefined();
  });

  it('addNotification (the shared choke point every existing notification already goes through) never throws even with a real subscription on file, unconfigured', async () => {
    const { token, userId } = await registerInvestidor();
    const endpoint = `https://push.example.com/${unique()}`;
    await request(app).post('/api/notifications/push/subscribe').set('Authorization', `Bearer ${token}`).send({ endpoint, keys: { p256dh: 'x', auth: 'y' } });
    expect(() => addNotification(userId, 'Teste de notificação', '#000', 'leilao')).not.toThrow();
  });
});
