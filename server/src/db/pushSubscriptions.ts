import { db } from './index.js';

export interface PushSubscriptionRow {
  id: number;
  user_id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  created_at: string;
}

export function addPushSubscription(userId: number, endpoint: string, p256dh: string, auth: string): PushSubscriptionRow {
  db.prepare(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`
  ).run(userId, endpoint, p256dh, auth);
  return db.prepare('SELECT * FROM push_subscriptions WHERE endpoint = ?').get(endpoint) as PushSubscriptionRow;
}

export function removePushSubscription(endpoint: string) {
  db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
}

export function listPushSubscriptionsByUser(userId: number): PushSubscriptionRow[] {
  return db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(userId) as PushSubscriptionRow[];
}
