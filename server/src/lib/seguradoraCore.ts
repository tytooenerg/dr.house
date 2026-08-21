import { z } from 'zod';
import { listInsuredByInsurerKey, listClaimableByInsurerKey, setSinistroStatus } from '../db/duplicatas.js';
import { recordAuditEvent } from '../db/audit.js';
import { addNotification } from '../db/misc.js';
import { deliverWebhookEvent } from './webhookDelivery.js';
import { INSURERS, COLORS } from '../data/seed.js';
import { fmtBRL } from './format.js';
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
  const totalPremio = apolices.reduce((sum, d) => sum + d.valor * ((insurer?.premioPct ?? 0) / 100), 0);
  const totalSegurado = apolices.reduce((sum, d) => sum + d.valor, 0);

  return {
    insurerName: insurer?.name ?? 'Seguradora não configurada',
    premioPctFmt: insurer?.premioFmt ?? '—',
    totalApolices: apolices.length,
    totalSeguradoFmt: fmtBRL(totalSegurado),
    totalPremioFmt: fmtBRL(totalPremio),
    apolices: apolices.map((d) => ({
      id: d.id,
      cedente: d.cedente_nome,
      sacado: d.sacado_nome,
      valorFmt: fmtBRL(d.valor),
      vencimento: d.vencimento,
      premioFmt: fmtBRL(d.valor * ((insurer?.premioPct ?? 0) / 100)),
      status: d.status,
      sinistroStatus: d.sinistro_status,
    })),
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
