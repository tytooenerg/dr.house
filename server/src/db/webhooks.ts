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
