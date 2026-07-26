import crypto from 'node:crypto';
import { listActiveWebhooksForEvent } from '../db/webhooks.js';
import { logger } from './logger.js';

// Fire-and-forget by design (callers don't await this) — a partner's unreachable
// endpoint must never slow down or fail the user-facing request that triggered it.
// Each delivery is signed the same way Stripe signs its own webhooks (HMAC-SHA256 over
// the raw body with a per-webhook secret) so partners can verify authenticity.
export async function deliverWebhookEvent(userId: number, event: string, payload: Record<string, unknown>): Promise<void> {
  const hooks = listActiveWebhooksForEvent(userId, event);
  if (hooks.length === 0) return;
  const body = JSON.stringify({ event, data: payload, sentAt: new Date().toISOString() });

  await Promise.all(
    hooks.map(async (hook) => {
      const signature = crypto.createHmac('sha256', hook.secret).update(body).digest('hex');
      try {
        await fetch(hook.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Lastro-Signature': signature, 'X-Lastro-Event': event },
          body,
        });
      } catch (err) {
        logger.warn({ err, url: hook.url, event }, '[webhooks] delivery failed');
      }
    })
  );
}
