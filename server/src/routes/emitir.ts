import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { emitirFormSchema, computeEmitirPreview, submitEmitir, submitEmitirLote, MAX_LOTE_ROWS } from '../lib/emitirCore.js';
import { asyncHandler } from '../lib/asyncHandler.js';

export const emitirRouter = Router();
emitirRouter.use(requireAuth);

emitirRouter.post('/preview', (req, res) => {
  const parsed = emitirFormSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
    return;
  }
  res.json(computeEmitirPreview(parsed.data));
});

emitirRouter.post(
  '/submit',
  asyncHandler(async (req, res) => {
    if (req.user!.role !== 'cedente') {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    const parsed = emitirFormSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', message: 'Preencha empresa sacada, valor e vencimento antes de enviar.' });
      return;
    }
    const outcome = await submitEmitir(req.user!, parsed.data);
    res.status(outcome.status).json(outcome.body);
  })
);

const loteSchema = z.object({ rows: z.array(z.record(z.string(), z.unknown())).min(1).max(MAX_LOTE_ROWS) });

// Real batch emission for high-volume cedentes — the client parses a CSV upload into rows
// and posts them here; each row emits for real via submitEmitirLote (same submitEmitir()
// path a single manual emission uses, same limits/compliance/registradora/webhook).
emitirRouter.post(
  '/lote',
  asyncHandler(async (req, res) => {
    if (req.user!.role !== 'cedente') {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    const parsed = loteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    const outcome = await submitEmitirLote(req.user!, parsed.data.rows);
    res.status(outcome.status).json(outcome.body);
  })
);
