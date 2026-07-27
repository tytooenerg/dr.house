import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { buyResaleListing, cancelResaleListing, createResaleListing, viewMyListings, viewMyResalablePositions, viewResaleMarket } from '../lib/resaleCore.js';
import { asyncHandler } from '../lib/asyncHandler.js';

export const secundarioRouter = Router();
secundarioRouter.use(requireAuth, requireRole('investidor'));

function payload(userId: number) {
  return { market: viewResaleMarket(), minhasPosicoes: viewMyResalablePositions(userId), meusAnuncios: viewMyListings(userId) };
}

secundarioRouter.get('/', (req, res) => res.json(payload(req.user!.id)));

const listSchema = z.object({ purchaseId: z.number().int().positive(), askingValor: z.string().trim() });

secundarioRouter.post(
  '/listar',
  asyncHandler(async (req, res) => {
    const parsed = listSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    const outcome = createResaleListing(req.user!, parsed.data.purchaseId, parsed.data.askingValor);
    res.status(outcome.status).json(outcome.status === 200 ? payload(req.user!.id) : outcome.body);
  })
);

secundarioRouter.post('/:id/cancelar', (req, res) => {
  const outcome = cancelResaleListing(req.user!, Number(req.params.id));
  res.status(outcome.status).json(outcome.status === 200 ? payload(req.user!.id) : outcome.body);
});

secundarioRouter.post(
  '/:id/comprar',
  asyncHandler(async (req, res) => {
    const outcome = buyResaleListing(req.user!, Number(req.params.id));
    res.status(outcome.status).json(outcome.status === 200 ? payload(req.user!.id) : outcome.body);
  })
);
