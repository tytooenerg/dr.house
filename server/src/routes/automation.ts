import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requirePlan } from '../auth/middleware.js';
import { getSettings, updateSettings } from '../db/users.js';
import { addAutomationActivity, listAutomationActivity } from '../db/misc.js';
import { fmtRelative } from '../lib/format.js';
import { AUTO_BID_OFFERS } from '../data/seed.js';

export const automationRouter = Router();
automationRouter.use(requireAuth, requirePlan('pro'));

const tickCache = new Map<number, number>();

function maybeTick(userId: number, settings: ReturnType<typeof getSettings>) {
  if (!settings.autoBidEnabled) return;
  const now = Date.now();
  const last = tickCache.get(userId) ?? 0;
  if (now - last < 4000) return;
  tickCache.set(userId, now);
  if (Math.random() > 0.5) return;

  const scoreOrder: Record<string, number> = { AA: 4, A: 3, B: 2, C: 1 };
  const minOrder = scoreOrder[settings.autoBidRules.scoreMin] || 3;
  const weights = AUTO_BID_OFFERS.map((o) => Math.max(1, (settings.diversification as Record<string, number>)[o.score] || 1));
  const totalW = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * totalW;
  let pick = AUTO_BID_OFFERS[0];
  for (let i = 0; i < AUTO_BID_OFFERS.length; i++) {
    if (r < weights[i]) {
      pick = AUTO_BID_OFFERS[i];
      break;
    }
    r -= weights[i];
  }
  const passesScore = scoreOrder[pick.score] >= minOrder;
  const classAlloc = (settings.diversification as Record<string, number>)[pick.score] || 0;
  const passes = passesScore && classAlloc > 0;
  const rate = (1.6 + Math.random() * 1.8).toFixed(1).replace('.', ',');
  const entry = passes
    ? { text: `Automação aplicada — lance de ${rate}% enviado em ${pick.sacado} (${pick.setor}, score ${pick.score}, ${classAlloc}% da carteira alocado nessa classe)`, color: '#0A5C36' }
    : !passesScore
      ? { text: `Oferta de ${pick.sacado} ignorada — score ${pick.score} abaixo do mínimo configurado (${settings.autoBidRules.scoreMin})`, color: '#5B6472' }
      : { text: `Oferta de ${pick.sacado} ignorada — classe de score ${pick.score} está zerada na diversificação da carteira`, color: '#5B6472' };
  addAutomationActivity(userId, entry.text, entry.color);
}

automationRouter.get('/', (req, res) => {
  const settings = getSettings(req.user!);
  maybeTick(req.user!.id, settings);
  res.json({
    autoBidEnabled: settings.autoBidEnabled,
    autoBidRules: settings.autoBidRules,
    diversification: settings.diversification,
    sectorDiversification: settings.sectorDiversification,
    autoBidActivity: listAutomationActivity(req.user!.id).map((a) => ({ text: a.text, color: a.color, time: fmtRelative(a.created_at) })),
  });
});

automationRouter.post('/toggle', (req, res) => {
  const settings = getSettings(req.user!);
  const updated = updateSettings(req.user!.id, { autoBidEnabled: !settings.autoBidEnabled });
  res.json({ autoBidEnabled: updated.autoBidEnabled });
});

const ruleSchema = z.object({ field: z.enum(['scoreMin', 'taxaMax', 'exposicaoSacado', 'exposicaoMensal']), value: z.string() });

automationRouter.post('/rule', (req, res) => {
  const parsed = ruleSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
    return;
  }
  const settings = getSettings(req.user!);
  const updated = updateSettings(req.user!.id, { autoBidRules: { ...settings.autoBidRules, [parsed.data.field]: parsed.data.value } });
  res.json({ autoBidRules: updated.autoBidRules });
});

const divSchema = z.object({ cls: z.enum(['AA', 'A', 'B', 'C']), value: z.number().min(0).max(100) });

automationRouter.post('/diversification', (req, res) => {
  const parsed = divSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
    return;
  }
  const settings = getSettings(req.user!);
  const updated = updateSettings(req.user!.id, { diversification: { ...settings.diversification, [parsed.data.cls]: parsed.data.value } });
  res.json({ diversification: updated.diversification });
});

const sectorSchema = z.object({ cls: z.enum(['varejo', 'industria', 'construcao', 'servicos']), value: z.number().min(0).max(100) });

automationRouter.post('/sector-diversification', (req, res) => {
  const parsed = sectorSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
    return;
  }
  const settings = getSettings(req.user!);
  const updated = updateSettings(req.user!.id, { sectorDiversification: { ...settings.sectorDiversification, [parsed.data.cls]: parsed.data.value } });
  res.json({ sectorDiversification: updated.sectorDiversification });
});
