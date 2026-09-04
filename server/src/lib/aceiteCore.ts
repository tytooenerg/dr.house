import { z } from 'zod';
import {
  listAceitesByCedente,
  listAceitesBySacadoNome,
  getAceite,
  getAceiteByDuplicata,
  setAceiteStatus,
  aceiteSlaStatus,
  listAguardandoComPrazo,
} from '../db/aceites.js';
import { getDuplicata, setStatus as setDuplicataStatus } from '../db/duplicatas.js';
import { addNotification } from '../db/misc.js';
import { createDispute, getDisputeByAceite } from '../db/disputes.js';
import { recordAuditEvent } from '../db/audit.js';
import { addSignal } from '../db/networkSignals.js';
import { getUserById, getSettings } from '../db/users.js';
import { currentCreditorFor } from './legalCollectionFee.js';
import { settleAtMaturity } from './settlement.js';
import { getFundoSistemaUserIdIfExists, fundoRetornoDePagamento } from './confirmingFundo.js';
import { getOfferingByDuplicata, listHoldingsForOffering } from '../db/fractionalOfferings.js';
import { settleFractionalAtMaturity } from './fractionalOfferings.js';
import { fmtBRL, fmtRelative } from './format.js';
import { COLORS } from '../data/seed.js';
import type { UserRow, DuplicataRow } from '../db/types.js';

export const STATUS_META = {
  aguardando: { label: 'Aguardando manifestação', bg: '#FBF1E0', color: COLORS.AMBER },
  aceita: { label: 'Aceita pelo sacado', bg: '#EAF3EE', color: COLORS.GREEN },
  contestada: { label: 'Contestada', bg: '#F7E9E7', color: COLORS.RED },
};

export const aceiteStatusSchema = z.object({ status: z.enum(['aceita', 'contestada']) });
export type AceiteStatusInput = z.infer<typeof aceiteStatusSchema>;

function view(
  a: {
    id: number;
    duplicata_id: string;
    status: keyof typeof STATUS_META;
    prazo_label: string;
    prazo_limite: string | null;
    valor: number;
    sacado_nome?: string;
    cedente_nome?: string;
    cedente_id?: number | null;
    duplicata_status?: string;
  },
  editable: boolean
) {
  const meta = STATUS_META[a.status];
  const sla = aceiteSlaStatus(a);
  // Proposta de resolução do cedente (routes/disputas.ts's POST /:id/propor) — só o
  // próprio sacado (editable) vê e só quando há uma pendente de fato, pra confirmar
  // (POST /disputas/:id/confirmar) ou recusar (POST /disputas/:id/recusar). Uma proposta
  // nunca resolve a disputa sozinha — precisa da confirmação do sacado.
  let disputeProposal: { disputeId: number; note: string; quando: string } | null = null;
  if (editable && a.status === 'contestada') {
    const dispute = getDisputeByAceite(a.id);
    if (dispute?.proposed_resolution) {
      disputeProposal = { disputeId: dispute.id, note: dispute.proposed_resolution, quando: dispute.proposed_at ? fmtRelative(dispute.proposed_at) : '' };
    }
  }
  // White-label Plus (lib/whitelabelBilling.ts): a sacado viewing their own aceite sees the
  // cedente's brand instead of "Lastro", same substitution already applied to WhatsApp
  // reminders (lib/aceiteReminder.ts) — but gated behind the paid tier, not the free
  // whitelabelBrand setup alone, so branding-only cedentes don't get this for free.
  let brandLabel: string | null = null;
  if (editable && a.cedente_id) {
    const cedente = getUserById(a.cedente_id);
    if (cedente?.whitelabel_plus_enabled) {
      const brand = getSettings(cedente).whitelabelBrand;
      if (brand?.nome) brandLabel = brand.nome;
    }
  }
  return {
    id: a.id,
    duplicataId: a.duplicata_id,
    valorFmt: fmtBRL(a.valor),
    prazo: a.prazo_label,
    status: a.status,
    statusLabel: meta.label,
    statusBg: meta.bg,
    statusColor: meta.color,
    isPending: a.status === 'aguardando',
    // Só o próprio sacado (editable) pode reportar, e só enquanto a duplicata ainda for uma
    // posição viva (aprovada/vendida) — mesmos estados que checkPaymentReportEligibility
    // exige; ver reportPayment abaixo pra checagem completa (inclui disputa em aberto).
    canReportPayment: editable && (a.duplicata_status === 'aprovada' || a.duplicata_status === 'vendida'),
    editable,
    sacado: a.sacado_nome,
    cedente: a.cedente_nome,
    brandLabel,
    slaDiasRestantes: sla.diasRestantes,
    slaVencido: sla.vencido,
    disputeProposal,
  };
}

// Achado corrigido (usuário apontou o requisito regulatório): uma duplicata só pode
// entrar em negociação (leilão, compra direta, cesta, auto-bid, fracionamento,
// financiamento automático via Confirming) depois que o sacado aceita — ou depois que o
// prazo do Banco Central pro aceite tácito vence, que no sistema já se traduz em
// aceite.status virar 'aceita' (applyTacitAcceptance, mais abaixo). Antes deste fix, todo
// ponto de compra só bloqueava 'contestada' — 'aguardando' passava normalmente, alguns
// nem isso. Predicado único, reutilizado em todos os pontos de compra/negociação.
export function aceiteConfirmado(duplicataId: string): boolean {
  return getAceiteByDuplicata(duplicataId)?.status === 'aceita';
}

// Shared by the internal /api/aceites route (used by the SPA, always sandbox=false) and
// the public /api/v1/aceites partner endpoints (sandbox = calling key's mode === 'test')
// — same visibility rules either way, just scoped to a different data plane.
export function listAceitesForUser(user: UserRow, sandbox = false) {
  if (user.role === 'cedente') {
    return listAceitesByCedente(user.id, sandbox).map((a) => view(a, false));
  }
  if (user.role === 'sacado') {
    return listAceitesBySacadoNome(user.company_name, sandbox).map((a) => view(a, true));
  }
  return [];
}

// Efeitos colaterais reais de uma decisão de aceite — extraído pra ser reutilizado tanto
// por decideAceite (o próprio sacado decidindo) quanto por applyTacitAcceptance (o
// sistema aplicando aceite tácito quando o prazo vence sem manifestação, mesma mecânica,
// nenhum UserRow de sacado disponível). Não inclui a checagem de autorização nem o
// recordAuditEvent (cada chamador registra o evento com o autor certo).
function applyAceiteDecision(aceite: { id: number }, duplicata: DuplicataRow, decision: AceiteStatusInput['status']) {
  setAceiteStatus(aceite.id, decision);
  if (decision === 'contestada' && !getDisputeByAceite(aceite.id)) {
    createDispute(aceite.id, 'Sacado contestou os dados da duplicata — divergência a esclarecer com o cedente.', {
      autor: duplicata.sacado_nome,
      texto: 'Contestou a duplicata.',
    });
  }
  if (duplicata.cedente_id) {
    const verb = decision === 'aceita' ? 'aceitou' : 'contestou';
    addNotification(
      duplicata.cedente_id,
      `${duplicata.sacado_nome} ${verb} a duplicata ${duplicata.id} (${fmtBRL(duplicata.valor)})`,
      decision === 'aceita' ? COLORS.GREEN : COLORS.RED,
      'aceite'
    );
    // A real aceite outcome is exactly the kind of first-party evidence the shared risk
    // network is meant to aggregate — feeds the same pool partners contribute to via the
    // public API, seeded by Lastro's own real activity instead of starting empty.
    if (duplicata.sacado_cnpj) {
      addSignal(duplicata.sacado_cnpj, duplicata.cedente_id, decision === 'aceita' ? 'pagamento_pontual' : 'contestacao');
    }
  }
}

// Achado corrigido: a UI (AceitePage.tsx) e o texto de compliance (data/seed.ts's
// FINANCIADOR_REQS) sempre prometeram "aceite tácito" quando o sacado não se manifesta
// dentro do prazo legal (aceites.ts's ACEITE_PRAZO_DIAS) — mas nada no sistema de fato
// aplicava isso; o aceite ficava 'aguardando' pra sempre. Chamado pelo job diário em
// lib/aceiteTacito.ts. `autor = null` porque não há um usuário agindo — é o próprio
// sistema aplicando uma consequência legal automática do silêncio do sacado.
export function applyTacitAcceptance(): number {
  let aplicados = 0;
  for (const a of listAguardandoComPrazo()) {
    const { vencido } = aceiteSlaStatus(a);
    if (!vencido) continue;
    const duplicata = getDuplicata(a.duplicata_id);
    if (!duplicata) continue;
    applyAceiteDecision(a, duplicata, 'aceita');
    recordAuditEvent(null, 'Aceite tácito (automático)', 'aceite.tacito', { duplicataId: duplicata.id, aceiteId: a.id });
    aplicados++;
  }
  return aplicados;
}

export type DecideAceiteOutcome =
  | { status: 200; body: { aceites: ReturnType<typeof listAceitesForUser> } }
  | { status: 403; body: { error: 'forbidden'; message: string } }
  | { status: 400; body: { error: 'validation_error'; message: string } }
  | { status: 404; body: { error: 'not_found' } };

// Shared by the internal POST /api/aceites/:id/status route (sandbox=false) and the
// public /api/v1/aceites/:id partner endpoint (sandbox = calling key's mode === 'test')
// — same business rules and side effects either way. A cross-mode id (a live key hitting
// a sandbox aceite's id, or vice versa) 404s exactly like /v1/duplicatas/:id, rather than
// leaking whether the id exists in the other data plane.
export async function decideAceite(user: UserRow, aceiteId: number, decision: AceiteStatusInput['status'], sandbox = false): Promise<DecideAceiteOutcome> {
  if (user.role !== 'sacado') {
    return { status: 403, body: { error: 'forbidden', message: 'Somente o sacado pode confirmar ou contestar uma duplicata.' } };
  }
  if (!Number.isFinite(aceiteId)) {
    return { status: 400, body: { error: 'validation_error', message: 'Id de aceite inválido.' } };
  }
  const aceite = getAceite(aceiteId);
  if (!aceite) {
    return { status: 404, body: { error: 'not_found' } };
  }
  const duplicata = getDuplicata(aceite.duplicata_id);
  if (!duplicata || !!duplicata.sandbox !== sandbox) {
    return { status: 404, body: { error: 'not_found' } };
  }
  if (duplicata.sacado_nome.toLowerCase() !== user.company_name.toLowerCase()) {
    return { status: 403, body: { error: 'forbidden', message: 'Esta duplicata não pertence à sua empresa.' } };
  }
  await new Promise((r) => setTimeout(r, 700));
  applyAceiteDecision(aceite, duplicata, decision);
  recordAuditEvent(user.id, user.company_name, `aceite.${decision}`, { duplicataId: duplicata.id });
  return { status: 200, body: { aceites: listAceitesForUser(user, sandbox) } };
}

export interface PaymentReportEligibility {
  eligible: boolean;
  reason?: string;
}

// Gate is deterministic — no LLM judgment call. A duplicata only makes sense to report as
// paid while it's still a live position (aprovada/vendida, never already 'paga') and there's
// no unresolved dispute open against it — same dispute check checkCollectionEligibility
// already uses for the opposite case (escalating to cobrança jurídica), but without
// requiring the vencimento to have passed: paying on time is the normal, expected case here.
export function checkPaymentReportEligibility(duplicata: DuplicataRow): PaymentReportEligibility {
  if (!['aprovada', 'vendida'].includes(duplicata.status)) {
    return { eligible: false, reason: 'Esta duplicata não está num estado que permita reportar pagamento.' };
  }
  const aceite = getAceiteByDuplicata(duplicata.id);
  if (aceite) {
    const dispute = getDisputeByAceite(aceite.id);
    if (dispute && !dispute.resolved) {
      return { eligible: false, reason: 'Existe disputa em aberto — resolva a disputa antes de reportar o pagamento.' };
    }
  }
  return { eligible: true };
}

export type ReportPaymentOutcome =
  | { status: 200; body: { aceites: ReturnType<typeof listAceitesForUser> } }
  | { status: 403; body: { error: 'forbidden'; message: string } }
  | { status: 404; body: { error: 'not_found' } }
  | { status: 409; body: { error: 'not_eligible' | 'no_creditor'; message: string } };

// Sacado self-reports having paid a duplicata at maturity — same self-service pattern
// lib/creditLine.ts's repayCreditLine already uses for a cedente reporting a credit-line
// repayment, since no real bank webhook exists to see either event automatically. Whoever
// currently holds the receivable (currentCreditorFor — the investor if it was sold, the
// cedente otherwise) is credited the full face value via settleAtMaturity; if it was
// financed by the Programa Confirming (the credor happens to be the fund's own system
// account), the fund's own ledger (fundoRetornoDePagamento) is credited too so NAV/cota
// reflects the real return — mirroring how fundoFinanciarCompra already records the outflow.
export function reportPayment(user: UserRow, aceiteId: number): ReportPaymentOutcome {
  if (user.role !== 'sacado') {
    return { status: 403, body: { error: 'forbidden', message: 'Somente o sacado pode reportar o pagamento de uma duplicata.' } };
  }
  const aceite = getAceite(aceiteId);
  if (!aceite) return { status: 404, body: { error: 'not_found' } };
  const duplicata = getDuplicata(aceite.duplicata_id);
  if (!duplicata) return { status: 404, body: { error: 'not_found' } };
  if (duplicata.sacado_nome.toLowerCase() !== user.company_name.toLowerCase()) {
    return { status: 403, body: { error: 'forbidden', message: 'Esta duplicata não pertence à sua empresa.' } };
  }
  const eligibility = checkPaymentReportEligibility(duplicata);
  if (!eligibility.eligible) {
    return { status: 409, body: { error: 'not_eligible', message: eligibility.reason! } };
  }

  // currentCreditorFor só conhece a tabela `purchases` de compra integral — uma duplicata
  // com um fracionamento (lib/fractionalOfferings.ts) nunca aparece lá, então sem esta
  // checagem o fallback creditaria o cedente de novo (já recebeu na venda dos tokens) e
  // nenhum investidor fracionado receberia nada de volta. Verificada antes de
  // currentCreditorFor, não depois — a oferta pode existir mesmo sem estar 'concluida'
  // (parte dos tokens nunca vendida), caso em que settleFractionalAtMaturity credita o
  // cedente só pela fração que ele nunca vendeu.
  const offering = getOfferingByDuplicata(duplicata.id);
  if (offering) {
    settleFractionalAtMaturity(duplicata, offering);
    setDuplicataStatus(duplicata.id, 'paga');
    if (aceite.status === 'aguardando') setAceiteStatus(aceite.id, 'aceita');
    for (const h of listHoldingsForOffering(offering.id)) {
      addNotification(
        h.investor_id,
        `${duplicata.sacado_nome} reportou o pagamento da duplicata ${duplicata.id} — ${h.tokens} token(s) fracionados creditados.`,
        COLORS.GREEN,
        'aceite'
      );
    }
    recordAuditEvent(user.id, user.company_name, 'duplicata.pagamento_reportado', { duplicataId: duplicata.id, fracionado: true });
    return { status: 200, body: { aceites: listAceitesForUser(user) } };
  }

  const creditor = currentCreditorFor(duplicata);
  if (!creditor) {
    return { status: 409, body: { error: 'no_creditor', message: 'Não foi possível identificar quem detém o direito ao recebível desta duplicata.' } };
  }

  settleAtMaturity({ duplicataId: duplicata.id, creditorId: creditor.userId, valor: duplicata.valor });
  const fundoSistemaUserId = getFundoSistemaUserIdIfExists();
  if (fundoSistemaUserId !== null && creditor.userId === fundoSistemaUserId) {
    fundoRetornoDePagamento(duplicata.id, duplicata.valor);
  }
  setDuplicataStatus(duplicata.id, 'paga');
  if (aceite.status === 'aguardando') setAceiteStatus(aceite.id, 'aceita');

  addNotification(
    creditor.userId,
    `${duplicata.sacado_nome} reportou o pagamento da duplicata ${duplicata.id} (${fmtBRL(duplicata.valor)}) — valor creditado.`,
    COLORS.GREEN,
    'aceite'
  );
  recordAuditEvent(user.id, user.company_name, 'duplicata.pagamento_reportado', { duplicataId: duplicata.id, creditorId: creditor.userId });
  return { status: 200, body: { aceites: listAceitesForUser(user) } };
}
