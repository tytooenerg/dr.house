import webpush from 'web-push';
import { logger } from './logger.js';
import { listPushSubscriptionsByUser, removePushSubscription } from '../db/pushSubscriptions.js';

// Real Web Push (RFC 8030 push protocol + RFC 8292 VAPID) via the `web-push` npm package —
// a real W3C/IETF standard, not a vendor-specific API, so unlike lib/esignature.ts there's
// no "which provider's exact contract" ambiguity here: any standards-compliant browser
// (Chrome, Firefox, Edge, Safari 16+) understands this on the receiving end. Real-when-
// configured, same discipline as every other channel in this codebase (email/SMS/WhatsApp):
// without VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY, sends are a no-op logged as such, never faked.
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:suporte@lastro.demo';
export const webPushEnabled = !!(vapidPublicKey && vapidPrivateKey);

if (webPushEnabled) {
  webpush.setVapidDetails(vapidSubject, vapidPublicKey!, vapidPrivateKey!);
  logger.info('[web-push] VAPID configurado — notificações push reais habilitadas');
} else {
  logger.info('[web-push] VAPID_PUBLIC_KEY/PRIVATE_KEY não configurados — notificações push desativadas (gere um par com `npx web-push generate-vapid-keys`)');
}

export function getVapidPublicKey(): string | null {
  return webPushEnabled ? vapidPublicKey! : null;
}

// Fire-and-forget by design (same as email/SMS sends elsewhere in this codebase) — a push
// failure never blocks or fails the real action that triggered the notification. A 404/410
// from the push service means the subscription is dead (browser uninstalled, permission
// revoked) — real cleanup, not a silent leak of stale endpoints.
export async function sendWebPush(userId: number, payload: { title: string; body: string; url?: string }) {
  if (!webPushEnabled) return;
  const subs = listPushSubscriptionsByUser(userId);
  if (subs.length === 0) return;
  const body = JSON.stringify(payload);
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, body);
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          removePushSubscription(sub.endpoint);
        } else {
          logger.warn({ err, userId }, '[web-push] falha ao enviar notificação push');
        }
      }
    })
  );
}
