import { z } from 'zod';
import { listInsuredByInsurerKey, listClaimableByInsurerKey, setSinistroStatus, setStatus as setDuplicataStatus } from '../db/duplicatas.js';
import { recordAuditEvent } from '../db/audit.js';
import { addNotification, addLedgerEntry } from '../db/misc.js';
import { deliverWebhookEvent } from './webhookDelivery.js';
import { INSURERS, COLORS } from '../data/seed.js';
import { fmtBRL } from './format.js';
import { getLatestInsuranceSettlement } from '../db/insuranceSettlements.js';
import { buildExposicao, apoliceEmRisco } from './insurerExposure.js';
import type { UserRow } from '../db/types.js';

export const sinistroDecisionSchema = z.object({ decision: z.enum(['aprovado', 'negado']), note: z.string().trim().min(1) });
export type SinistroDecisionInput = z.infer<typeof sinistroDecisionSchema>;

function insurerDef(insurerKey: string | null) {
  return INSURERS.find((i) => i.key === insurerKey) ?? null;
}

// Shared by the internal GET /api/seguradora route (used by the SPA, always sandbox=false)
// and the public /api/v1/seguradora partner endpoint (sandbox = a test-mode key's own
// isolated data plane — see db/duplicatas.ts) — same payload shape either way.
export function buildSeguradoraPayload(user: UserRow, sandbox = false) {
  const insurer = insurerDef(user.insurer_key);
  const apolices = insurer ? listInsuredByInsurerKey(insurer.key, sandbox) : [];
  const claimable = insurer ? listClaimableByInsurerKey(insurer.key, sandbox) : [];
  const totalSegurado = apolices.reduce((sum, d) => sum + d.valor, 0);

  // O prêmio de cada apólice é o que foi REALMENTE cobrado, gravado uma vez em
  // insurance_settlements no momento da contratação (migração 0010). Este painel
  // recalculava com o premioPct fixo do catálogo (0,55%/0,60%/0,68%), ignorando que as
  // cotações variam de 0,30% a 0,90% conforme o risco de cada duplicata
  // (lib/insuranceQuotes.ts) — ou seja, a seguradora via um faturamento que não era o dela.
  // O investidor e o relatório de receita já liam o valor gravado; só o painel de quem
  // vende o seguro não lia.
  const premioDe = (duplicataId: string): number | null => getLatestInsuranceSettlement(duplicataId)?.premio ?? null;
  // Apólice sem registro de liquidação nunca teve prêmio cobrado (dado semeado ou legado):
  // entra como "não registrado" e soma zero, em vez de receber um número estimado que
  // apareceria como receita que ninguém pagou.
  const totalPremio = apolices.reduce((sum, d) => sum + (premioDe(d.id) ?? 0), 0);
  const exposicao = insurer ? buildExposicao(insurer.key, sandbox) : null;

  return {
    insurerName: insurer?.name ?? 'Seguradora não configurada',
    premioPctFmt: insurer?.premioFmt ?? '—',
    totalApolices: apolices.length,
    totalSeguradoFmt: fmtBRL(totalSegurado),
    totalPremioFmt: fmtBRL(totalPremio),
    exposicao,
    apolices: apolices.map((d) => {
      const premio = premioDe(d.id);
      return {
        id: d.id,
        cedente: d.cedente_nome,
        sacado: d.sacado_nome,
        valorFmt: fmtBRL(d.valor),
        vencimento: d.vencimento,
        premioFmt: premio === null ? 'não registrado' : fmtBRL(premio),
        emRisco: apoliceEmRisco(d),
        status: d.status,
        sinistroStatus: d.sinistro_status,
      };
    }),
    sinistros: claimable.map((d) => ({
      id: d.id,
      cedente: d.cedente_nome,
      sacado: d.sacado_nome,
      valorFmt: fmtBRL(d.valor),
      vencimento: d.vencimento,
    })),
  };
}

export type DecideSinistroOutcome =
  | { status: 200; body: ReturnType<typeof buildSeguradoraPayload> }
  | { status: 409; body: { error: 'no_insurer'; message: string } }
  | { status: 404; body: { error: 'not_found'; message: string } };

// Shared by the internal POST /api/seguradora/sinistro/:duplicataId/decidir route
// (sandbox=false) and the public /api/v1/seguradora/sinistro/:duplicataId/decidir partner
// endpoint (sandbox = the caller's key mode) — same side effects either way. `claimable` is
// already scoped to the right data plane, so a test-mode key can never find (and decide) a
// real sinistro's ID even if it guesses one correctly, and vice versa — same protection
// GET /v1/duplicatas/:id already has (db/duplicatas.ts's sandbox filter).
export function decideSinistro(user: UserRow, duplicataId: string, input: SinistroDecisionInput, sandbox = false): DecideSinistroOutcome {
  const insurer = insurerDef(user.insurer_key);
  if (!insurer) {
    return { status: 409, body: { error: 'no_insurer', message: 'Sua conta não está vinculada a uma seguradora parceira.' } };
  }
  const claimable = listClaimableByInsurerKey(insurer.key, sandbox);
  const target = claimable.find((d) => d.id === duplicataId);
  if (!target) {
    return { status: 404, body: { error: 'not_found', message: 'Sinistro não encontrado ou já decidido.' } };
  }
  setSinistroStatus(target.id, input.decision === 'aprovado' ? 'aprovado' : 'negado', input.note);
  // Aprovar um sinistro dizia "indenizará" na notificação mas nunca movia dinheiro nenhum —
  // mesma classe de bug já corrigida em settlePurchase/settleFractionalAtMaturity/
  // recordRecovery: uma promessa de pagamento real precisa de um addLedgerEntry real. A
  // seguradora paga o valor de face integral (o prêmio, cobrado à parte em
  // settleInsurance, já remunerou o risco assumido — não se desconta de novo aqui), e a
  // duplicata vira 'paga' pra não também aparecer como candidata a cobrança jurídica
  // (lib/legalCollection.ts) e ser "recuperada" uma segunda vez pelo mesmo valor.
  if (input.decision === 'aprovado' && target.cedente_id) {
    const hoje = new Date().toLocaleDateString('pt-BR');
    addLedgerEntry(user.id, hoje, `Indenização de sinistro — duplicata ${target.id}`, -target.valor);
    addLedgerEntry(target.cedente_id, hoje, `Indenização de sinistro recebida — duplicata ${target.id} (${insurer.name})`, target.valor);
    setDuplicataStatus(target.id, 'paga');
  }
  if (target.cedente_id) {
    const verb = input.decision === 'aprovado' ? 'aprovou o sinistro e indenizará' : 'negou o sinistro de';
    addNotification(
      target.cedente_id,
      `${insurer.name} ${verb} a duplicata ${target.id} (${fmtBRL(target.valor)}): ${input.note}`,
      input.decision === 'aprovado' ? COLORS.GREEN : COLORS.RED,
      'disputa'
    );
    void deliverWebhookEvent(target.cedente_id, 'sinistro.decidido', {
      duplicataId: target.id,
      decision: input.decision,
      note: input.note,
      insurer: insurer.key,
    });
  }
  recordAuditEvent(user.id, user.company_name, 'sinistro.decidido', { duplicataId: target.id, decision: input.decision });
  return { status: 200, body: buildSeguradoraPayload(user, sandbox) };
}
