import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { emitirFormSchema, computeEmitirPreview, submitEmitir } from '../lib/emitirCore.js';
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
