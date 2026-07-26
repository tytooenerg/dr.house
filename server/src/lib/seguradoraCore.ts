import { z } from 'zod';
import { listInsuredByInsurerKey, listClaimableByInsurerKey, setSinistroStatus } from '../db/duplicatas.js';
import { recordAuditEvent } from '../db/audit.js';
import { addNotification } from '../db/misc.js';
import { INSURERS, COLORS } from '../data/seed.js';
import { fmtBRL } from './format.js';
import type { UserRow } from '../db/types.js';

export const sinistroDecisionSchema = z.object({ decision: z.enum(['aprovado', 'negado']), note: z.string().trim().min(1) });
export type SinistroDecisionInput = z.infer<typeof sinistroDecisionSchema>;

function insurerDef(insurerKey: string | null) {
  return INSURERS.find((i) => i.key === insurerKey) ?? null;
}

// Shared by the internal GET /api/seguradora route (used by the SPA) and the public
// /api/v1/seguradora partner endpoint — same payload shape either way.
export function buildSeguradoraPayload(user: UserRow) {
  const insurer = insurerDef(user.insurer_key);
  const apolices = insurer ? listInsuredByInsurerKey(insurer.key) : [];
  const claimable = insurer ? listClaimableByInsurerKey(insurer.key) : [];
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

// Shared by the internal POST /api/seguradora/sinistro/:duplicataId/decidir route and the
// public /api/v1/seguradora/sinistros/:id partner endpoint — same side effects either way.
export function decideSinistro(user: UserRow, duplicataId: string, input: SinistroDecisionInput): DecideSinistroOutcome {
  const insurer = insurerDef(user.insurer_key);
  if (!insurer) {
    return { status: 409, body: { error: 'no_insurer', message: 'Sua conta não está vinculada a uma seguradora parceira.' } };
  }
  const claimable = listClaimableByInsurerKey(insurer.key);
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
  }
  recordAuditEvent(user.id, user.company_name, 'sinistro.decidido', { duplicataId: target.id, decision: input.decision });
  return { status: 200, body: buildSeguradoraPayload(user) };
}
