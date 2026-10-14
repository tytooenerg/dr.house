import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { aceiteStatusSchema, decideAceite, listAceitesForUser, reportPayment } from '../lib/aceiteCore.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { conviteSchema, criarConvite } from '../lib/aceiteConvite.js';

export const aceiteRouter = Router();
aceiteRouter.use(requireAuth);

aceiteRouter.get('/', (req, res) => {
  res.json({ aceites: listAceitesForUser(req.user!) });
});

aceiteRouter.post(
  '/:id/status',
  asyncHandler(async (req, res) => {
    const parsed = aceiteStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    const outcome = await decideAceite(req.user!, Number(req.params.id), parsed.data.status);
    res.status(outcome.status).json(outcome.body);
  })
);

// Sacado self-reporta o pagamento no vencimento — ver lib/aceiteCore.ts's reportPayment
// pra por que isso é necessário (nenhum sinal automático de banco/PSP existe hoje).
aceiteRouter.post('/:id/pagamento', (req, res) => {
  const outcome = reportPayment(req.user!, Number(req.params.id));
  res.status(outcome.status).json(outcome.body);
});

// A empresa convida o sacado a responder por link, sem conta (lib/aceiteConvite.ts).
aceiteRouter.post(
  '/:id/convite',
  asyncHandler(async (req, res) => {
    const parsed = conviteSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', message: parsed.error.issues[0]?.message ?? 'Dados inválidos.' });
      return;
    }
    const out = await criarConvite(req.user!, Number(req.params.id), { email: parsed.data.email || undefined, telefone: parsed.data.telefone || undefined });
    res.status(out.status).json(out.status === 200 ? { ...out.body, aceites: listAceitesForUser(req.user!) } : out.body);
  })
);
