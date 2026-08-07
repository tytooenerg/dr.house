import { z } from 'zod';
import { listAceitesByCedente, listAceitesBySacadoNome, getAceite, setAceiteStatus, aceiteSlaStatus } from '../db/aceites.js';
import { getDuplicata } from '../db/duplicatas.js';
import { addNotification } from '../db/misc.js';
import { createDispute, getDisputeByAceite } from '../db/disputes.js';
import { recordAuditEvent } from '../db/audit.js';
import { addSignal } from '../db/networkSignals.js';
import { fmtBRL } from './format.js';
import { COLORS } from '../data/seed.js';
import type { UserRow } from '../db/types.js';

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
  },
  editable: boolean
) {
  const meta = STATUS_META[a.status];
  const sla = aceiteSlaStatus(a);
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
    editable,
    sacado: a.sacado_nome,
    cedente: a.cedente_nome,
    slaDiasRestantes: sla.diasRestantes,
    slaVencido: sla.vencido,
  };
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
  recordAuditEvent(user.id, user.company_name, `aceite.${decision}`, { duplicataId: duplicata.id });
  return { status: 200, body: { aceites: listAceitesForUser(user, sandbox) } };
}
