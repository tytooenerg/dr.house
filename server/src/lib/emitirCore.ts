import { z } from 'zod';
import { countByCedenteThisMonth, createDuplicata, findDuplicataByNfeChave, sacadoValorStats, setStatus, setComplianceScore } from '../db/duplicatas.js';
import { runComplianceEngine } from './complianceEngine.js';
import { recordComplianceResult } from '../db/complianceEngine.js';
import { ensureAceite } from '../db/aceites.js';
import { recordAuditEvent } from '../db/audit.js';
import { createComplianceAlert } from '../db/complianceAlerts.js';
import { deliverWebhookEvent } from './webhookDelivery.js';
import { BASICO_MONTHLY_EMIT_LIMIT, planAtLeast } from './billing.js';
import { platformFee } from './settlement.js';
import { chooseRegistradora, registrarNaRegistradora } from './registradoras.js';
import { fmtBRL, parseBRLNumber } from './format.js';
import { logger } from './logger.js';
import { COLORS, SACADOS } from '../data/seed.js';
import type { UserRow } from '../db/types.js';

export const emitirFormSchema = z.object({
  sacado: z.string().trim(),
  cnpj: z.string().trim().optional().default(''),
  valor: z.string().trim(),
  vencimento: z.string().trim(),
  seguro: z.boolean().optional().default(false),
  nfAnexada: z.boolean().optional().default(false),
  nfeChave: z.string().trim().optional().default(''),
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
      plataformaFeeFmt: totalValor ? fmtBRL(platformFee(totalValor)) : '—',
      totalValor,
    },
    sacadoRecognized: !!matched,
    sacadoRecognizedText: matched ? `${form.sacado} já tem histórico na Lastro — rating ${matched.rating}, score ${matched.score}.` : '',
  };
}

export type EmitirOutcome =
  | { status: 200; body: { ok: true; registro: string; duplicataId: string; seguro: boolean; registradora: string; complianceSuspensa: boolean } }
  | { status: 400; body: { error: 'validation_error'; message: string } }
  | { status: 402; body: { error: 'plan_required'; requiredPlan: 'pro'; message: string } }
  | { status: 409; body: { error: 'nfe_duplicidade'; message: string } }
  | { status: 502; body: { error: 'cerc_unavailable'; message: string } };

const NFE_CHAVE_RE = /^\d{44}$/;

// Shared by the internal /api/emitir/submit route (used by the SPA) and the public
// /api/v1/duplicatas partner endpoint — same business rules and side effects either way.
export async function submitEmitir(user: UserRow, form: EmitirForm): Promise<EmitirOutcome> {
  if (!form.sacado || !form.valor || !form.vencimento) {
    return { status: 400, body: { error: 'validation_error', message: 'Preencha empresa sacada, valor e vencimento antes de enviar.' } };
  }
  const nfeChave = form.nfeChave.replace(/\D/g, '');
  if (nfeChave && !NFE_CHAVE_RE.test(nfeChave)) {
    return { status: 400, body: { error: 'validation_error', message: 'Chave de acesso da NF-e inválida — deve ter 44 dígitos.' } };
  }
  // Prevents the same NF-e from backing two different duplicatas inside Lastro's own
  // book — the most basic form of the "duplicidade" fraud the market flags as its
  // biggest concern when buying duplicatas from an unfamiliar originator.
  if (nfeChave) {
    const existing = findDuplicataByNfeChave(nfeChave);
    if (existing) {
      createComplianceAlert({
        type: 'nfe_duplicidade',
        severity: 'critico',
        message: `Tentativa de reemitir NF-e já vinculada à duplicata ${existing.id} (bloqueada)`,
        userId: user.id,
        duplicataId: existing.id,
      });
      return {
        status: 409,
        body: { error: 'nfe_duplicidade', message: `Esta NF-e já está vinculada à duplicata ${existing.id} — possível duplicidade.` },
      };
    }
  }
  const monthlyLimit = BASICO_MONTHLY_EMIT_LIMIT + user.referral_bonus_emissions;
  if (!planAtLeast(user.plan, 'pro') && countByCedenteThisMonth(user.id) >= monthlyLimit) {
    return {
      status: 402,
      body: {
        error: 'plan_required',
        requiredPlan: 'pro',
        message: `Seu plano Básico permite até ${monthlyLimit} emissões por mês${user.referral_bonus_emissions > 0 ? ' (incluindo bônus de indicação)' : ''}. Faça upgrade para o Pro para emitir sem limites, ou indique outra empresa para ganhar mais emissões.`,
      },
    };
  }
  const valorNum = parseBRLNumber(form.valor);
  const batchTotal = form.batchValores.reduce((sum, v) => sum + parseBRLNumber(v), 0);
  const totalValorForAlert = valorNum + batchTotal;
  if (form.cnpj) {
    const stats = sacadoValorStats(form.cnpj);
    if (stats.n >= 3 && totalValorForAlert > stats.avg * 3) {
      createComplianceAlert({
        type: 'valor_anomalo',
        severity: 'atencao',
        message: `Duplicata de ${fmtBRL(totalValorForAlert)} para ${form.sacado} — 3x acima da média histórica (${fmtBRL(stats.avg)})`,
        userId: user.id,
      });
    }
  }
  // Smart-routed once, before the (simulated) network round-trip, so a failure and a
  // retry with the same form land on the same registradora — matches how a real
  // integration would work.
  const registradora = chooseRegistradora(valorNum + batchTotal);

  const preview = computeEmitirPreview(form);
  let registro: string;
  try {
    // Real HTTP round-trip when REGISTRADORA_<X>_API_URL/KEY is configured for the chosen
    // registradora; otherwise the same simulated delay + registro-number generation this
    // always did (see lib/registradoras.ts).
    const result = await registrarNaRegistradora({
      registradoraKey: registradora.key,
      duplicataId: `dup_pending_${Date.now()}`,
      valor: valorNum + batchTotal,
      sacadoCnpj: form.cnpj,
      vencimento: form.vencimento,
    });
    registro = result.registro;
    if (!result.simulado) {
      logger.info({ registradora: registradora.key, registro }, '[emitir] registro real confirmado pela registradora');
    }
  } catch (err) {
    logger.warn({ err, registradora: registradora.key }, '[emitir] falha ao registrar na registradora');
    return { status: 502, body: { error: 'cerc_unavailable', message: `Falha ao registrar na ${registradora.name} — conexão instável. Tente novamente.` } };
  }
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
    registradora: registradora.key,
    nfeChave: nfeChave || null,
  });
  ensureAceite(duplicata.id, '10 dias úteis restantes');
  recordAuditEvent(user.id, user.company_name, 'duplicata.registrada', { duplicataId: duplicata.id, registro, registradora: registradora.key });
  void deliverWebhookEvent(user.id, 'duplicata.registrada', {
    duplicataId: duplicata.id,
    registro,
    sacado: form.sacado,
    valor: valorNum + batchTotal,
    vencimento: form.vencimento,
    registradora: registradora.key,
  });

  // Compliance AI Engine — real, deterministic 0-100 score combining duplicidade, PLD,
  // valor anômalo and score do sacado (see lib/complianceEngine.ts). A score at/above the
  // threshold suspends the duplicata for human review instead of letting it reach
  // 'aprovada'/the marketplace — never an automatic permanent block.
  let suspended = false;
  try {
    const outcome = await runComplianceEngine({
      duplicataId: duplicata.id,
      sacadoNome: form.sacado,
      sacadoCnpj: form.cnpj,
      valor: valorNum + batchTotal,
      vencimento: form.vencimento,
      cedenteId: user.id,
      cedente: user,
    });
    setComplianceScore(duplicata.id, outcome.score);
    recordComplianceResult({ duplicataId: duplicata.id, score: outcome.score, breakdown: outcome.breakdown, reasoning: outcome.reasoning, decision: outcome.decision });
    if (outcome.decision === 'suspenso_para_revisao') {
      setStatus(duplicata.id, 'suspensa_compliance');
      suspended = true;
      recordAuditEvent(user.id, user.company_name, 'duplicata.compliance_suspensa', { duplicataId: duplicata.id, score: outcome.score });
    }
  } catch (err) {
    logger.warn({ err, duplicataId: duplicata.id }, '[compliance-engine] falha ao pontuar a duplicata — seguindo sem suspensão automática');
  }

  return {
    status: 200,
    body: {
      ok: true,
      registro,
      duplicataId: duplicata.id,
      seguro: form.seguro,
      registradora: registradora.name,
      complianceSuspensa: suspended,
    },
  };
}
