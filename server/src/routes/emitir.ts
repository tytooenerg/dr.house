import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { countByCedenteThisMonth, createDuplicata } from '../db/duplicatas.js';
import { ensureAceite } from '../db/aceites.js';
import { recordAuditEvent } from '../db/audit.js';
import { BASICO_MONTHLY_EMIT_LIMIT, planAtLeast } from '../lib/billing.js';
import { fmtBRL, parseBRLNumber } from '../lib/format.js';
import { COLORS, SACADOS } from '../data/seed.js';
import { asyncHandler } from '../lib/asyncHandler.js';

export const emitirRouter = Router();
emitirRouter.use(requireAuth);

const formSchema = z.object({
  sacado: z.string().trim(),
  cnpj: z.string().trim().optional().default(''),
  valor: z.string().trim(),
  vencimento: z.string().trim(),
  seguro: z.boolean().optional().default(false),
  nfAnexada: z.boolean().optional().default(false),
  batchValores: z.array(z.string()).optional().default([]),
});

const RATE_BANDS: Record<string, [number, number]> = { AA: [1.2, 1.6], A: [1.5, 2.0], B: [2.2, 2.9], C: [3.2, 4.2] };

function computePreview(form: z.infer<typeof formSchema>) {
  const valorNum = parseBRLNumber(form.valor);
  const batchTotal = form.batchValores.reduce((sum, v) => sum + parseBRLNumber(v), 0);
  const totalValor = valorNum + batchTotal;
  const matched = SACADOS[form.sacado];
  const emitPremio = form.seguro ? valorNum * 0.006 : 0;
  const band = matched ? RATE_BANDS[matched.rating] ?? RATE_BANDS.A : RATE_BANDS.A;
  const taxaMid = (band[0] + band[1]) / 2;
  const platformFeePct = totalValor > 1000000 ? 0.0025 : totalValor > 200000 ? 0.003 : 0.0035;

  const items = [
    { label: 'Dados do sacado e CNPJ', done: !!(form.sacado && form.cnpj) },
    { label: 'Valor e vencimento definidos', done: !!(form.valor && form.vencimento) },
    { label: 'NF-e anexada e vinculada', done: form.nfAnexada },
    { label: 'Comprovante de entrega ou aceite do serviço', done: form.nfAnexada },
    { label: 'Histórico de pagamento do sacado consultado', done: !!form.sacado },
  ];
  const doneCount = items.filter((i) => i.done).length;
  const pct = Math.round((doneCount / items.length) * 100);
  const color = pct === 100 ? COLORS.GREEN : pct >= 40 ? COLORS.AMBER : COLORS.RED;
  const preApprovedLimit = 40000 + doneCount * 25000 + (matched ? matched.score * 1500 : 0);

  return {
    lastroChecklist: {
      items: items.map((i) => ({ label: i.label, done: i.done, color: i.done ? COLORS.GREEN : '#D6DCE5', textColor: i.done ? COLORS.NAVY : '#9AA5B5' })),
      pct,
      color,
      doneCount,
    },
    preApprovedLimit,
    emitSummary: {
      valorFmt: valorNum ? fmtBRL(valorNum) : '—',
      premioFmt: emitPremio ? fmtBRL(emitPremio) : form.seguro ? 'R$ 0' : 'Não contratado',
      taxaEstimadaFmt: taxaMid.toFixed(1).replace('.', ',') + '% a.m.',
      plataformaFeeFmt: totalValor ? fmtBRL(totalValor * platformFeePct) : '—',
      totalValor,
    },
    sacadoRecognized: !!matched,
    sacadoRecognizedText: matched ? `${form.sacado} já tem histórico na Lastro — rating ${matched.rating}, score ${matched.score}.` : '',
  };
}

emitirRouter.post('/preview', (req, res) => {
  const parsed = formSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
    return;
  }
  res.json(computePreview(parsed.data));
});

emitirRouter.post(
  '/submit',
  asyncHandler(async (req, res) => {
    if (req.user!.role !== 'cedente') {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    const parsed = formSchema.safeParse(req.body);
    if (!parsed.success || !parsed.data.sacado || !parsed.data.valor || !parsed.data.vencimento) {
      res.status(400).json({ error: 'validation_error', message: 'Preencha empresa sacada, valor e vencimento antes de enviar.' });
      return;
    }
    if (!planAtLeast(req.user!.plan, 'pro') && countByCedenteThisMonth(req.user!.id) >= BASICO_MONTHLY_EMIT_LIMIT) {
      res.status(402).json({
        error: 'plan_required',
        requiredPlan: 'pro',
        message: `Seu plano Básico permite até ${BASICO_MONTHLY_EMIT_LIMIT} emissões por mês. Faça upgrade para o Pro para emitir sem limites.`,
      });
      return;
    }
    await new Promise((r) => setTimeout(r, 1100));
    if (Math.random() < 0.12) {
      res.status(502).json({ error: 'cerc_unavailable', message: 'Falha ao registrar na CERC — conexão instável. Tente novamente.' });
      return;
    }
    const preview = computePreview(parsed.data);
    const registro = 'ESC-2026-' + Math.floor(Math.random() * 900000 + 100000);
    const valorNum = parseBRLNumber(parsed.data.valor);
    const batchTotal = parsed.data.batchValores.reduce((sum, v) => sum + parseBRLNumber(v), 0);
    const duplicata = createDuplicata({
      cedenteId: req.user!.id,
      cedenteNome: req.user!.company_name,
      sacadoNome: parsed.data.sacado,
      sacadoCnpj: parsed.data.cnpj,
      valor: valorNum + batchTotal,
      vencimento: parsed.data.vencimento,
      emissao: new Date().toLocaleDateString('pt-BR'),
      status: preview.lastroChecklist.pct === 100 ? 'aprovada' : 'pendente_analise',
      lastroPct: preview.lastroChecklist.pct,
      seguro: parsed.data.seguro,
      registro,
    });
    ensureAceite(duplicata.id, '10 dias úteis restantes');
    recordAuditEvent(req.user!.id, req.user!.company_name, 'duplicata.registrada', { duplicataId: duplicata.id, registro });
    res.json({ ok: true, registro, duplicataId: duplicata.id, seguro: parsed.data.seguro });
  })
);
