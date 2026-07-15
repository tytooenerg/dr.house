import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { hasUnread, listNotifications, markNotificationsRead } from '../db/misc.js';
import { fmtRelative } from '../lib/format.js';

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
