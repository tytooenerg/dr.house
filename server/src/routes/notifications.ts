import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { hasUnread, listNotifications, markNotificationsRead } from '../db/misc.js';
import { addPushSubscription, removePushSubscription } from '../db/pushSubscriptions.js';
import { getVapidPublicKey, webPushEnabled } from '../lib/webPush.js';
import { fmtRelative } from '../lib/format.js';
import { asyncHandler } from '../lib/asyncHandler.js';

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

notificationsRouter.get('/', (req, res) => {
  const notifications = listNotifications(req.user!.id).map((n) => ({ text: n.text, color: n.color, time: fmtRelative(n.created_at) }));
  res.json({ notifications, unread: hasUnread(req.user!.id) });
});

notificationsRouter.post('/read', (req, res) => {
  markNotificationsRead(req.user!.id);
  res.json({ ok: true });
});

// Real Web Push (lib/webPush.ts) — the client fetches the real VAPID public key here to
// call pushManager.subscribe(), then posts the resulting subscription back. Configured is
// exposed so the UI can hide the opt-in toggle entirely instead of offering a button that
// would silently do nothing without VAPID keys set server-side.
notificationsRouter.get('/push/config', (_req, res) => {
  res.json({ enabled: webPushEnabled, publicKey: getVapidPublicKey() });
});

const pushSubscribeSchema = z.object({
  endpoint: z.string().trim().url(),
  keys: z.object({ p256dh: z.string().trim().min(1), auth: z.string().trim().min(1) }),
});

notificationsRouter.post(
  '/push/subscribe',
  asyncHandler(async (req, res) => {
    const parsed = pushSubscribeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    addPushSubscription(req.user!.id, parsed.data.endpoint, parsed.data.keys.p256dh, parsed.data.keys.auth);
    res.json({ ok: true });
  })
);

notificationsRouter.post(
  '/push/unsubscribe',
  asyncHandler(async (req, res) => {
    const parsed = z.object({ endpoint: z.string().trim().url() }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    removePushSubscription(parsed.data.endpoint);
    res.json({ ok: true });
  })
);
