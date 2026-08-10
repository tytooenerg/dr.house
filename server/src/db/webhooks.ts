import { db } from './index.js';
import type { WebhookRow } from './types.js';

export function createWebhook(userId: number, url: string, event: string, secret: string): WebhookRow {
  const info = db.prepare('INSERT INTO webhooks (user_id, url, event, secret) VALUES (?, ?, ?, ?)').run(userId, url, event, secret);
  return db.prepare('SELECT * FROM webhooks WHERE id = ?').get(Number(info.lastInsertRowid)) as WebhookRow;
}

export function listWebhooks(userId: number): WebhookRow[] {
  return db.prepare('SELECT * FROM webhooks WHERE user_id = ? ORDER BY created_at DESC').all(userId) as WebhookRow[];
}

export function listActiveWebhooksForEvent(userId: number, event: string): WebhookRow[] {
  return db.prepare('SELECT * FROM webhooks WHERE user_id = ? AND event = ? AND active = 1').all(userId, event) as WebhookRow[];
}

export function deleteWebhook(userId: number, webhookId: number) {
  db.prepare('DELETE FROM webhooks WHERE id = ? AND user_id = ?').run(webhookId, userId);
}

export function deleteAllWebhooksForUser(userId: number) {
  db.prepare('DELETE FROM webhooks WHERE user_id = ?').run(userId);
}

export function getWebhook(userId: number, webhookId: number): WebhookRow | undefined {
  return db.prepare('SELECT * FROM webhooks WHERE id = ? AND user_id = ?').get(webhookId, userId) as WebhookRow | undefined;
}

// Real secret rotation — a partner whose signing secret leaked (checked into a repo,
// exposed in a log, an employee departure) doesn't have to delete and recreate the
// webhook (losing its delivery history) just to invalidate the old secret. The new value
// takes effect on the very next delivery attempt — lib/webhookDelivery.ts always reads
// the row fresh, never caches a secret across deliveries.
export function rotateWebhookSecret(userId: number, webhookId: number, newSecret: string): WebhookRow | undefined {
  db.prepare('UPDATE webhooks SET secret = ? WHERE id = ? AND user_id = ?').run(newSecret, webhookId, userId);
  return getWebhook(userId, webhookId);
}
