import { db } from './index.js';
import type { WebhookDeliveryRow, WebhookDeliveryStatus } from './types.js';

export function createDelivery(webhookId: number, event: string, payload: string): WebhookDeliveryRow {
  const info = db
    .prepare('INSERT INTO webhook_deliveries (webhook_id, event, payload) VALUES (?, ?, ?)')
    .run(webhookId, event, payload);
  return db.prepare('SELECT * FROM webhook_deliveries WHERE id = ?').get(Number(info.lastInsertRowid)) as WebhookDeliveryRow;
}

export function recordDeliveryAttempt(id: number, attempt: number, status: WebhookDeliveryStatus, responseStatus: number | null, error: string | null) {
  db.prepare(
    `UPDATE webhook_deliveries SET attempt = ?, status = ?, response_status = ?, error = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(attempt, status, responseStatus, error, id);
}

export function listDeliveriesForWebhook(userId: number, webhookId: number, limit = 20): WebhookDeliveryRow[] {
  return db
    .prepare(
      `SELECT wd.* FROM webhook_deliveries wd
       JOIN webhooks w ON w.id = wd.webhook_id
       WHERE w.user_id = ? AND wd.webhook_id = ?
       ORDER BY wd.id DESC LIMIT ?`
    )
    .all(userId, webhookId, limit) as WebhookDeliveryRow[];
}
