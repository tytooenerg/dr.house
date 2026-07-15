import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { getSettings, updateSettings } from '../db/users.js';
import { ERP_CONNECTORS_META } from '../data/seed.js';

export const erpRouter = Router();
erpRouter.use(requireAuth);

function payload(settings: ReturnType<typeof getSettings>) {
  return {
    connectors: ERP_CONNECTORS_META.map((c) => ({
      ...c,
      connected: (settings.erpConnections as Record<string, boolean>)[c.key],
      btnLabel: (settings.erpConnections as Record<string, boolean>)[c.key] ? 'Conectado ✓' : 'Conectar',
      btnBg: (settings.erpConnections as Record<string, boolean>)[c.key] ? '#EAF3EE' : '#1E5EFF',
      btnColor: (settings.erpConnections as Record<string, boolean>)[c.key] ? '#0A5C36' : '#fff',
    })),
    whitelabelOn: settings.erpConnections.whitelabel,
  };
}

erpRouter.get('/', (req, res) => res.json(payload(getSettings(req.user!))));

erpRouter.post('/:key/toggle', (req, res) => {
  const settings = getSettings(req.user!);
  const key = req.params.key as keyof typeof settings.erpConnections;
  if (!(key in settings.erpConnections)) {
    res.status(400).json({ error: 'invalid_connector' });
    return;
  }
  const updated = updateSettings(req.user!.id, { erpConnections: { ...settings.erpConnections, [key]: !settings.erpConnections[key] } });
  res.json(payload(updated));
});
