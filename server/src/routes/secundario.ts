import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../auth/middleware.js';
import {
  acceptBid,
  buyResaleListing,
  cancelBid,
  cancelResaleListing,
  createResaleListing,
  placeBid,
  placeBidSchema,
  rejectBid,
  viewMyBids,
  viewMyListings,
  viewMyResalablePositions,
  viewResaleMarket,
} from '../lib/resaleCore.js';
import { blockTradeCriteriaSchema, runBlockTrade, viewMyBlockTrades } from '../lib/blockTrade.js';
import { abrirOtc, contrapropor, aceitarOtc, encerrarOtc, viewMinhasOtc, OTC_PRAZO_MAX_HORAS } from '../lib/otcCore.js';
import { asyncHandler } from '../lib/asyncHandler.js';

export const secundarioRouter = Router();
secundarioRouter.use(requireAuth, requireRole('investidor'));

function payload(userId: number) {
  return {
    market: viewResaleMarket(),
    minhasPosicoes: viewMyResalablePositions(userId),
    meusAnuncios: viewMyListings(userId),
    meusLances: viewMyBids(userId),
    meusBlockTrades: viewMyBlockTrades(userId),
    // Só as negociações DESTE usuário: balcão não tem visão pública (lib/otcCore.ts).
    minhasOtc: viewMinhasOtc(userId),
  };
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

// Market depth: a buyer offers a price instead of taking the listing's asking price
// outright — the seller decides whether to accept it (POST /lances/:bidId/aceitar below).
secundarioRouter.post(
  '/:id/lances',
  asyncHandler(async (req, res) => {
    const parsed = placeBidSchema.safeParse({ listingId: Number(req.params.id), valor: req.body?.valor });
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    const outcome = placeBid(req.user!, parsed.data.listingId, parsed.data.valor);
    res.status(outcome.status).json(outcome.status === 200 ? payload(req.user!.id) : outcome.body);
  })
);

secundarioRouter.post('/lances/:bidId/cancelar', (req, res) => {
  const outcome = cancelBid(req.user!, Number(req.params.bidId));
  res.status(outcome.status).json(outcome.status === 200 ? payload(req.user!.id) : outcome.body);
});

// Seller-only — enforced inside acceptBid/rejectBid by comparing req.user against the
// listing's seller_id, same ownership-check shape as every other resale mutation.
secundarioRouter.post('/lances/:bidId/aceitar', (req, res) => {
  const outcome = acceptBid(req.user!, Number(req.params.bidId));
  res.status(outcome.status).json(outcome.status === 200 ? payload(req.user!.id) : outcome.body);
});

secundarioRouter.post('/lances/:bidId/recusar', (req, res) => {
  const outcome = rejectBid(req.user!, Number(req.params.bidId));
  res.status(outcome.status).json(outcome.status === 200 ? payload(req.user!.id) : outcome.body);
});

// Institutional block trade — see lib/blockTrade.ts for the eligibility bar (declared
// patrimônio líquido), minimum size, and matching logic.
secundarioRouter.post(
  '/block-trade',
  asyncHandler(async (req, res) => {
    const parsed = blockTradeCriteriaSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    const outcome = runBlockTrade(req.user!, parsed.data);
    if (outcome.status !== 200) {
      res.status(outcome.status).json(outcome.body);
      return;
    }
    res.status(200).json({ ...outcome.body, ...payload(req.user!.id) });
  })
);


// --- Balcão (OTC) ---
// Negociação dirigida a quem detém uma posição, sobre uma duplicata que não precisa estar
// anunciada, com contraproposta e prazo. Privada entre as duas partes — ver lib/otcCore.ts
// para por que o book existente não cobre este caso.
const otcAberturaSchema = z.object({
  duplicataId: z.string().trim().min(1),
  valor: z.string().trim().min(1),
  prazoHoras: z.number().positive().max(OTC_PRAZO_MAX_HORAS).optional(),
  nota: z.string().trim().max(500).optional(),
});
const otcContrapropostaSchema = z.object({ valor: z.string().trim().min(1), nota: z.string().trim().max(500).optional() });

secundarioRouter.post('/otc', (req, res) => {
  const parsed = otcAberturaSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
    return;
  }
  const outcome = abrirOtc(req.user!, {
    duplicataId: parsed.data.duplicataId,
    valorRaw: parsed.data.valor,
    prazoHoras: parsed.data.prazoHoras,
    nota: parsed.data.nota,
  });
  if (outcome.status !== 200) {
    res.status(outcome.status).json(outcome.body);
    return;
  }
  res.json({ ...outcome.body, ...payload(req.user!.id) });
});

secundarioRouter.post('/otc/:id/contraproposta', (req, res) => {
  const parsed = otcContrapropostaSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
    return;
  }
  const outcome = contrapropor(req.user!, Number(req.params.id), parsed.data.valor, parsed.data.nota);
  if (outcome.status !== 200) {
    res.status(outcome.status).json(outcome.body);
    return;
  }
  res.json({ ...outcome.body, ...payload(req.user!.id) });
});

secundarioRouter.post('/otc/:id/aceitar', (req, res) => {
  const outcome = aceitarOtc(req.user!, Number(req.params.id));
  if (outcome.status !== 200) {
    res.status(outcome.status).json(outcome.body);
    return;
  }
  res.json({ ...outcome.body, ...payload(req.user!.id) });
});

secundarioRouter.post('/otc/:id/encerrar', (req, res) => {
  const neg = viewMinhasOtc(req.user!.id).find((n) => n.id === Number(req.params.id));
  // Recusar (a proposta é da contraparte) e cancelar (a proposta é sua) são o mesmo ato visto
  // de lados diferentes da mesa; o rótulo sai de quem está encerrando.
  const como = neg?.minhaVez ? 'recusada' : 'cancelada';
  const outcome = encerrarOtc(req.user!, Number(req.params.id), como);
  if (outcome.status !== 200) {
    res.status(outcome.status).json(outcome.body);
    return;
  }
  res.json({ ...outcome.body, ...payload(req.user!.id) });
});
