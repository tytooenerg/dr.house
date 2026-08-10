import crypto from 'node:crypto';
import { listActiveWebhooksForEvent } from '../db/webhooks.js';
import { createDelivery, recordDeliveryAttempt } from '../db/webhookDeliveries.js';
import { checkUrlIsPublic } from './ssrfGuard.js';
import { logger } from './logger.js';

// Configurable so tests don't leave 30-minute timers running past the test file's
// lifetime — real production delays are immediate / 30s / 5min / 30min, but under
// Vitest we default to a fast schedule unless a test explicitly overrides it.
function retryDelaysMs(): number[] {
  const raw = process.env.WEBHOOK_RETRY_DELAYS_MS;
  if (raw) {
    return raw
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n >= 0);
  }
  if (process.env.VITEST) return [0, 20, 20];
  return [0, 30_000, 300_000, 1_800_000];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function attemptDelivery(deliveryId: number, url: string, secret: string, body: string, event: string, attempt: number): Promise<boolean> {
  // Re-checked on every attempt, not just at registration time (routes/dev.ts) — retries
  // are spread out up to 30 minutes apart, long enough for a DNS-rebinding attacker to
  // repoint an initially-public hostname at an internal address after it passed
  // validation. See lib/ssrfGuard.ts / docs/security-review-2026-08.md finding SR-1.
  const check = await checkUrlIsPublic(url);
  if (!check.safe) {
    recordDeliveryAttempt(deliveryId, attempt, 'failed', null, `blocked: ${check.reason || 'destino não permitido'}`);
    logger.warn({ deliveryId, url }, '[webhooks] delivery blocked — destination no longer resolves to a public address');
    return false;
  }
  const signature = crypto.createHmac('sha256', secret).update(body).digest('hex');
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Lastro-Signature': signature, 'X-Lastro-Event': event },
      body,
      signal: AbortSignal.timeout(8000),
    });
    const ok = res.status >= 200 && res.status < 300;
    recordDeliveryAttempt(deliveryId, attempt, ok ? 'success' : 'failed', res.status, ok ? null : `HTTP ${res.status}`);
    return ok;
  } catch (err) {
    recordDeliveryAttempt(deliveryId, attempt, 'failed', null, err instanceof Error ? err.message : 'network error');
    return false;
  }
}

async function deliverWithRetry(deliveryId: number, url: string, secret: string, body: string, event: string): Promise<void> {
  const delays = retryDelaysMs();
  for (let i = 0; i < delays.length; i++) {
    if (delays[i] > 0) await sleep(delays[i]);
    const ok = await attemptDelivery(deliveryId, url, secret, body, event, i + 1);
    if (ok) return;
  }
  logger.warn({ deliveryId, url, event }, '[webhooks] delivery permanently failed after retries');
}

// Callers don't await this (fire-and-forget) — a partner's unreachable endpoint must
// never slow down or fail the user-facing request that triggered it. Each attempt is
// signed the same way Stripe signs its own webhooks (HMAC-SHA256 over the raw body with
// a per-webhook secret) and logged to webhook_deliveries so partners can see delivery
// history (and we can retry) instead of silently losing failed events.
export async function deliverWebhookEvent(userId: number, event: string, payload: Record<string, unknown>): Promise<void> {
  const hooks = listActiveWebhooksForEvent(userId, event);
  if (hooks.length === 0) return;
  const body = JSON.stringify({ event, data: payload, sentAt: new Date().toISOString() });

  await Promise.all(
    hooks.map(async (hook) => {
      const delivery = createDelivery(hook.id, event, body);
      await deliverWithRetry(delivery.id, hook.url, hook.secret, body, event);
    })
  );
}
