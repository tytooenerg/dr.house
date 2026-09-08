import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requirePlan, requireRole } from '../auth/middleware.js';
import { buildCashflowForecast } from '../lib/cashflowForecast.js';
import { buildCfoRecommendation, candidatasParaAntecipacao } from '../lib/cfoDecisionEngine.js';
import { getSettings } from '../db/users.js';
import { dispararLeilao, setInsurer } from '../db/duplicatas.js';
import { recordAuditEvent } from '../db/audit.js';
import { listInsuranceQuotes } from '../lib/insuranceQuotes.js';
import { asyncHandler } from '../lib/asyncHandler.js';

export const cashflowRouter = Router();
// Feature "AI CFO fica atrás de Pro/Empresarial" — até aqui era o único recurso de peso
// liberado de graça no plano Básico. Pro e Empresarial ganham a projeção real de caixa;
// só o Empresarial ganha o DRE simplificado/saldo bancário real/benchmark, gated dentro de
// buildCashflowForecast (por req.user!.plan), não aqui — a rota em si só decide "tem CFO
// ou não tem".
cashflowRouter.use(requireAuth, requireRole('cedente'), requirePlan('pro'));

cashflowRouter.get(
  '/forecast',
  asyncHandler(async (req, res) => {
    const settings = getSettings(req.user!);
    const forecast = await buildCashflowForecast(req.user!.id, req.user!.plan, settings.companyCnpj);
    res.json(forecast);
  })
);

// O Motor de Decisão (lib/cfoDecisionEngine.ts) — de "há um déficit" para "antecipe estas
// duplicatas, a este custo".
cashflowRouter.get(
  '/recomendacao',
  asyncHandler(async (req, res) => {
    const settings = getSettings(req.user!);
    res.json(await buildCfoRecommendation(req.user!.id, req.user!.plan, settings.companyCnpj));
  })
);

const executarSchema = z.object({
  duplicataIds: z.array(z.string()).min(1),
  comSeguro: z.boolean().optional(),
  taxaMaxima: z.number().positive().max(20).optional(),
});

// Executa o plano: contrata o seguro escolhido (quando pedido) e abre o leilão de cada
// duplicata com a reserva da recomendação.
cashflowRouter.post(
  '/recomendacao/executar',
  asyncHandler(async (req, res) => {
    const parsed = executarSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    // Revalida contra o estado de AGORA em vez de confiar no corpo: entre ver a recomendação e
    // clicar em Executar, uma duplicata pode ter sido contestada, disparada por outro caminho
    // ou deixado de ser elegível. O que não passa aqui é reportado, não silenciado.
    const elegiveis = new Map(candidatasParaAntecipacao(req.user!.id, null).map((d) => [d.id, d]));
    const abertas: string[] = [];
    const ignoradas: string[] = [];
    const closeAt = new Date(Date.now() + 6 * 3600 * 1000).toISOString();

    for (const id of parsed.data.duplicataIds) {
      const d = elegiveis.get(id);
      if (!d) {
        ignoradas.push(id);
        continue;
      }
      if (parsed.data.comSeguro) {
        const cotacao = listInsuranceQuotes(d)[0];
        if (cotacao) setInsurer(d.id, cotacao.key);
      }
      dispararLeilao(d.id, closeAt, parsed.data.taxaMaxima);
      abertas.push(d.id);
    }

    recordAuditEvent(req.user!.id, req.user!.company_name, 'cfo.plano_executado', {
      abertas: abertas.length,
      ignoradas: ignoradas.length,
      comSeguro: !!parsed.data.comSeguro,
      taxaMaxima: parsed.data.taxaMaxima ?? null,
    });

    const settings = getSettings(req.user!);
    res.json({
      abertas,
      ignoradas,
      recomendacao: await buildCfoRecommendation(req.user!.id, req.user!.plan, settings.companyCnpj),
    });
  })
);
