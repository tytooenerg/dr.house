import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { getAdvertisementByAdvertiser, upsertAdvertisement, setAdvertisementAtivo } from '../db/advertisements.js';
import { fmtAddOnPrice } from '../lib/addOnBilling.js';
import { recordAuditEvent } from '../db/audit.js';

// Self-service side of the ad carousel (feature "Carrossel de publicidade") — the
// 'anunciante' role's only real tab. Every route here is scoped to the caller's own
// account; the admin moderation queue (GET/POST /admin/advertisements*) and the public
// carousel feed (GET /public/advertisements) live in their own routers.
export const advertisementsRouter = Router();
advertisementsRouter.use(requireAuth, requireRole('anunciante'));

function payload(ad: ReturnType<typeof getAdvertisementByAdvertiser>) {
  return {
    ad: ad
      ? {
          logoUrl: ad.logo_url,
          titulo: ad.titulo,
          texto: ad.texto,
          linkUrl: ad.link_url,
          status: ad.status,
          ativo: !!ad.ativo,
          rejectReason: ad.reject_reason,
          impressoes: ad.impressoes,
          cliques: ad.cliques,
        }
      : null,
    precoMensalFmt: fmtAddOnPrice('publicidade_carrossel'),
  };
}

advertisementsRouter.get('/me', (req, res) => {
  res.json(payload(getAdvertisementByAdvertiser(req.user!.id)));
});

const upsertSchema = z.object({
  logoUrl: z.string().trim().url().max(500),
  titulo: z.string().trim().min(1).max(60),
  texto: z.string().trim().min(1).max(160),
  linkUrl: z.string().trim().url().max(500),
});

advertisementsRouter.post('/me', (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
    return;
  }
  const ad = upsertAdvertisement(req.user!.id, parsed.data);
  recordAuditEvent(req.user!.id, req.user!.company_name, 'advertisement.submetido', { adId: ad.id });
  res.json(payload(ad));
});

const toggleSchema = z.object({ ativo: z.boolean() });

advertisementsRouter.post('/me/toggle', (req, res) => {
  const parsed = toggleSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
    return;
  }
  const existing = getAdvertisementByAdvertiser(req.user!.id);
  if (!existing) {
    res.status(404).json({ error: 'not_found', message: 'Configure seu anúncio antes de ativá-lo.' });
    return;
  }
  const ad = setAdvertisementAtivo(req.user!.id, parsed.data.ativo);
  res.json(payload(ad));
});
