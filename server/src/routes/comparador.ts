import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { fmtBRL, parseBRLNumber } from '../lib/format.js';
import { RATE_CHANNELS } from '../data/seed.js';

export const comparadorRouter = Router();
comparadorRouter.use(requireAuth);

const RATE_BANDS: Record<string, [number, number]> = { AA: [1.2, 1.6], A: [1.5, 2.0], B: [2.2, 2.9], C: [3.2, 4.2] };

const schema = z.object({
  valor: z.string().trim().optional().default('50.000'),
  prazo: z.string().trim().optional().default('30'),
  score: z.enum(['AA', 'A', 'B', 'C']).optional().default('A'),
});

comparadorRouter.post('/estimate', (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
    return;
  }
  const valorNum = parseBRLNumber(parsed.data.valor);
  const prazoNum = parseInt(parsed.data.prazo, 10) || 30;
  const band = RATE_BANDS[parsed.data.score];
  const prazoFactor = prazoNum / 30;
  const lowRate = band[0] * prazoFactor;
  const highRate = band[1] * prazoFactor;
  const midRate = (lowRate + highRate) / 2;
  const desagioEstimado = valorNum * (midRate / 100);
  res.json({
    rangeLabel: `${lowRate.toFixed(1).replace('.', ',')}% – ${highRate.toFixed(1).replace('.', ',')}% no período`,
    desagioFmt: valorNum ? fmtBRL(desagioEstimado) : '—',
    liquidoFmt: valorNum ? fmtBRL(valorNum - desagioEstimado) : '—',
    rateChannels: RATE_CHANNELS,
  });
});

comparadorRouter.get('/rates', (_req, res) => {
  res.json({ rateChannels: RATE_CHANNELS });
});
