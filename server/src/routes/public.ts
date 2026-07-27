import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { buildPublicStats } from '../lib/publicStatsCore.js';
import { computeUptimePct, listRecentHealthChecks } from '../db/systemHealth.js';
import { computeEmitirPreview } from '../lib/emitirCore.js';
import { fmtRelative } from '../lib/format.js';

// Fully public, unauthenticated endpoints: the transparency page, the status page, and
// the embeddable rate simulator widget — all meant to be called from outside the app
// (a partner's own site, an anonymous visitor) so none of them require login.
export const publicRouter = Router();

publicRouter.get('/stats', (_req, res) => {
  res.json(buildPublicStats());
});

publicRouter.get('/status', (_req, res) => {
  const history = listRecentHealthChecks(50);
  res.json({
    current: history[0] ? { status: history[0].status, latencyMs: history[0].latency_ms, checkedAt: fmtRelative(history[0].created_at) } : null,
    uptimePct24h: computeUptimePct(24),
    uptimePct7d: computeUptimePct(24 * 7),
    history: history.map((h) => ({ status: h.status, latencyMs: h.latency_ms, checkedAt: fmtRelative(h.created_at) })),
  });
});

const simulateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited', message: 'Muitas simulações — tente novamente em instantes.' },
});

const simulateSchema = z.object({
  sacado: z.string().trim().optional().default(''),
  valor: z.string().trim(),
  vencimento: z.string().trim().optional().default(''),
});

// Powers the embeddable "simule sua antecipação" widget — reuses the exact same rate
// model as the real Emitir Duplicata flow (lib/emitirCore.ts), just without persisting
// anything, so the number a visitor sees is never fictional.
publicRouter.post('/simular', simulateLimiter, (req, res) => {
  const parsed = simulateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
    return;
  }
  const preview = computeEmitirPreview({
    sacado: parsed.data.sacado,
    cnpj: '',
    valor: parsed.data.valor,
    vencimento: parsed.data.vencimento,
    seguro: false,
    nfAnexada: false,
    batchValores: [],
  });
  res.json({
    valorFmt: preview.emitSummary.valorFmt,
    taxaEstimadaFmt: preview.emitSummary.taxaEstimadaFmt,
    plataformaFeeFmt: preview.emitSummary.plataformaFeeFmt,
    sacadoRecognized: preview.sacadoRecognized,
    sacadoRecognizedText: preview.sacadoRecognizedText,
  });
});
