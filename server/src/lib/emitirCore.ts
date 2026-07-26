import { z } from 'zod';
import { countByCedenteThisMonth, createDuplicata } from '../db/duplicatas.js';
import { ensureAceite } from '../db/aceites.js';
import { recordAuditEvent } from '../db/audit.js';
import { deliverWebhookEvent } from './webhookDelivery.js';
import { BASICO_MONTHLY_EMIT_LIMIT, planAtLeast } from './billing.js';
import { fmtBRL, parseBRLNumber } from './format.js';
import { COLORS, SACADOS } from '../data/seed.js';
import type { UserRow } from '../db/types.js';

export const emitirFormSchema = z.object({
  sacado: z.string().trim(),
  cnpj: z.string().trim().optional().default(''),
  valor: z.string().trim(),
  vencimento: z.string().trim(),
  seguro: z.boolean().optional().default(false),
  nfAnexada: z.boolean().optional().default(false),
  batchValores: z.array(z.string()).optional().default([]),
});

export type EmitirForm = z.infer<typeof emitirFormSchema>;

const RATE_BANDS: Record<string, [number, number]> = { AA: [1.2, 1.6], A: [1.5, 2.0], B: [2.2, 2.9], C: [3.2, 4.2] };

export function computeEmitirPreview(form: EmitirForm) {
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

export type EmitirOutcome =
  | { status: 200; body: { ok: true; registro: string; duplicataId: string; seguro: boolean } }
  | { status: 400; body: { error: 'validation_error'; message: string } }
  | { status: 402; body: { error: 'plan_required'; requiredPlan: 'pro'; message: string } }
  | { status: 502; body: { error: 'cerc_unavailable'; message: string } };

// Shared by the internal /api/emitir/submit route (used by the SPA) and the public
// /api/v1/duplicatas partner endpoint — same business rules and side effects either way.
export async function submitEmitir(user: UserRow, form: EmitirForm): Promise<EmitirOutcome> {
  if (!form.sacado || !form.valor || !form.vencimento) {
    return { status: 400, body: { error: 'validation_error', message: 'Preencha empresa sacada, valor e vencimento antes de enviar.' } };
  }
  if (!planAtLeast(user.plan, 'pro') && countByCedenteThisMonth(user.id) >= BASICO_MONTHLY_EMIT_LIMIT) {
    return {
      status: 402,
      body: {
        error: 'plan_required',
        requiredPlan: 'pro',
        message: `Seu plano Básico permite até ${BASICO_MONTHLY_EMIT_LIMIT} emissões por mês. Faça upgrade para o Pro para emitir sem limites.`,
      },
    };
  }
  await new Promise((r) => setTimeout(r, 1100));
  if (Math.random() < 0.12) {
    return { status: 502, body: { error: 'cerc_unavailable', message: 'Falha ao registrar na CERC — conexão instável. Tente novamente.' } };
  }

  const preview = computeEmitirPreview(form);
  const registro = 'ESC-2026-' + Math.floor(Math.random() * 900000 + 100000);
  const valorNum = parseBRLNumber(form.valor);
  const batchTotal = form.batchValores.reduce((sum, v) => sum + parseBRLNumber(v), 0);
  const duplicata = createDuplicata({
    cedenteId: user.id,
    cedenteNome: user.company_name,
    sacadoNome: form.sacado,
    sacadoCnpj: form.cnpj,
    valor: valorNum + batchTotal,
    vencimento: form.vencimento,
    emissao: new Date().toLocaleDateString('pt-BR'),
    status: preview.lastroChecklist.pct === 100 ? 'aprovada' : 'pendente_analise',
    lastroPct: preview.lastroChecklist.pct,
    seguro: form.seguro,
    registro,
  });
  ensureAceite(duplicata.id, '10 dias úteis restantes');
  recordAuditEvent(user.id, user.company_name, 'duplicata.registrada', { duplicataId: duplicata.id, registro });
  void deliverWebhookEvent(user.id, 'duplicata.registrada', {
    duplicataId: duplicata.id,
    registro,
    sacado: form.sacado,
    valor: valorNum + batchTotal,
    vencimento: form.vencimento,
  });

  return { status: 200, body: { ok: true, registro, duplicataId: duplicata.id, seguro: form.seguro } };
}
