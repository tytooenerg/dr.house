import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { getSettings, updateSettings } from '../db/users.js';
import { ERP_CONNECTORS_META } from '../data/seed.js';
import { testOmieConnection, listarContasReceberOmie } from '../lib/erpConnectors/omie.js';
import { asyncHandler } from '../lib/asyncHandler.js';

export const erpRouter = Router();
erpRouter.use(requireAuth);

function payload(settings: ReturnType<typeof getSettings>) {
  return {
    connectors: ERP_CONNECTORS_META.map((c) => ({
      ...c,
      // Omie is a real integration (see lib/erpConnectors/omie.ts) — connecting it needs
      // real Omie app_key/app_secret from the user's own account, not a bare toggle.
      // SAP/TOTVS stay as clearly-labeled placeholders (no free self-serve API for either
      // the way Omie has) until a real integration is built for them.
      real: c.key === 'omie',
      connected: (settings.erpConnections as Record<string, boolean>)[c.key],
      btnLabel: (settings.erpConnections as Record<string, boolean>)[c.key] ? 'Conectado ✓' : c.key === 'omie' ? 'Conectar com credenciais reais' : 'Conectar (em breve)',
      btnBg: (settings.erpConnections as Record<string, boolean>)[c.key] ? '#EAF3EE' : '#1E5EFF',
      btnColor: (settings.erpConnections as Record<string, boolean>)[c.key] ? '#0A5C36' : '#fff',
    })),
    whitelabelOn: settings.erpConnections.whitelabel,
    omieConnected: settings.erpConnections.omie,
  };
}

erpRouter.get('/', (req, res) => res.json(payload(getSettings(req.user!))));

// SAP/TOTVS/whitelabel — no real integration built yet, stays a placeholder toggle. Real
// Omie connections must go through /omie/connect below (needs real credentials).
erpRouter.post('/:key/toggle', (req, res) => {
  const settings = getSettings(req.user!);
  const key = req.params.key as keyof typeof settings.erpConnections;
  if (!(key in settings.erpConnections) || key === 'omie') {
    res.status(400).json({ error: 'invalid_connector' });
    return;
  }
  const updated = updateSettings(req.user!.id, { erpConnections: { ...settings.erpConnections, [key]: !settings.erpConnections[key] } });
  res.json(payload(updated));
});

const omieConnectSchema = z.object({ appKey: z.string().trim().min(1), appSecret: z.string().trim().min(1) });

// Real connection: validates the credentials against Omie's actual API before marking
// the connector as connected — unlike the boolean-only toggle this used to be.
erpRouter.post(
  '/omie/connect',
  asyncHandler(async (req, res) => {
    const parsed = omieConnectSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    const test = await testOmieConnection(parsed.data.appKey, parsed.data.appSecret);
    if (!test.ok) {
      res.status(400).json({ error: 'omie_auth_failed', message: test.error || 'Não foi possível validar as credenciais Omie.' });
      return;
    }
    const settings = getSettings(req.user!);
    const updated = updateSettings(req.user!.id, {
      omieCredentials: { appKey: parsed.data.appKey, appSecret: parsed.data.appSecret },
      erpConnections: { ...settings.erpConnections, omie: true },
    });
    res.json(payload(updated));
  })
);

erpRouter.post('/omie/disconnect', (req, res) => {
  const settings = getSettings(req.user!);
  const updated = updateSettings(req.user!.id, {
    omieCredentials: null,
    erpConnections: { ...settings.erpConnections, omie: false },
  });
  res.json(payload(updated));
});

// Real contas-a-receber pull from the cedente's own Omie account — the data Emitir
// Duplicata can prefill from instead of manual entry.
erpRouter.get(
  '/omie/contas-receber',
  asyncHandler(async (req, res) => {
    const settings = getSettings(req.user!);
    if (!settings.omieCredentials) {
      res.status(409).json({ error: 'omie_not_connected' });
      return;
    }
    const result = await listarContasReceberOmie(settings.omieCredentials.appKey, settings.omieCredentials.appSecret);
    if (!result.ok) {
      res.status(502).json({ error: 'omie_fetch_failed', message: result.error });
      return;
    }
    res.json({ contas: result.contas });
  })
);
