import { db } from './index.js';
import { toIsoUtc } from '../lib/format.js';
import type { AceiteRow } from './types.js';

// Legal aceite window: the sacado has up to 15 days to accept a duplicata escritural
// (or 10 to refuse it) before its validity is at risk — the same deadline already
// documented in the Compliance screen's financiador requirements, now actually enforced
// as a computed field instead of just descriptive copy.
const ACEITE_PRAZO_DIAS = 15;

export function ensureAceite(duplicataId: string, prazoLabel: string): AceiteRow {
  const existing = db.prepare('SELECT * FROM aceites WHERE duplicata_id = ?').get(duplicataId) as AceiteRow | undefined;
  if (existing) return existing;
  db.prepare(`INSERT INTO aceites (duplicata_id, prazo_label, prazo_limite) VALUES (?, ?, datetime('now', '+${ACEITE_PRAZO_DIAS} days'))`).run(
    duplicataId,
    prazoLabel
  );
  return db.prepare('SELECT * FROM aceites WHERE duplicata_id = ?').get(duplicataId) as AceiteRow;
}

export function aceiteSlaStatus(row: Pick<AceiteRow, 'status' | 'prazo_limite'>): { diasRestantes: number | null; vencido: boolean } {
  if (row.status !== 'aguardando' || !row.prazo_limite) return { diasRestantes: null, vencido: false };
  const msRestantes = new Date(toIsoUtc(row.prazo_limite)).getTime() - Date.now();
  const diasRestantes = Math.ceil(msRestantes / 86_400_000);
  return { diasRestantes, vencido: diasRestantes < 0 };
}

export function getAceite(id: number): AceiteRow | undefined {
  return db.prepare('SELECT * FROM aceites WHERE id = ?').get(id) as AceiteRow | undefined;
}

export function getAceiteByDuplicata(duplicataId: string): AceiteRow | undefined {
  return db.prepare('SELECT * FROM aceites WHERE duplicata_id = ?').get(duplicataId) as AceiteRow | undefined;
}

// `sandbox` scopes to the same live/test data plane as db/duplicatas.ts: internal SPA
// callers never pass it (always sandbox=0, i.e. real data only); the v1 partner API
// passes the calling key's mode so a test-mode key only ever sees its own seeded
// sandbox aceites, never real ones (and vice versa) — see lib/sandboxData.ts.
export function listAceitesByCedente(cedenteId: number, sandbox = false): (AceiteRow & { sacado_nome: string; valor: number })[] {
  return db
    .prepare(
      `SELECT a.*, d.sacado_nome as sacado_nome, d.valor as valor FROM aceites a
       JOIN duplicatas d ON d.id = a.duplicata_id
       WHERE d.cedente_id = ? AND d.sandbox = ? ORDER BY a.created_at DESC`
    )
    .all(cedenteId, sandbox ? 1 : 0) as (AceiteRow & { sacado_nome: string; valor: number })[];
}

export function listAceitesBySacadoNome(sacadoNome: string, sandbox = false): (AceiteRow & { valor: number; cedente_nome: string; cedente_id: number | null })[] {
  return db
    .prepare(
      `SELECT a.*, d.valor as valor, d.cedente_nome as cedente_nome, d.cedente_id as cedente_id FROM aceites a
       JOIN duplicatas d ON d.id = a.duplicata_id
       WHERE lower(d.sacado_nome) = lower(?) AND d.sandbox = ? ORDER BY a.created_at DESC`
    )
    .all(sacadoNome, sandbox ? 1 : 0) as (AceiteRow & { valor: number; cedente_nome: string; cedente_id: number | null })[];
}

export function setAceiteStatus(id: number, status: 'aceita' | 'aguardando' | 'contestada') {
  db.prepare('UPDATE aceites SET status = ? WHERE id = ?').run(status, id);
}

export interface AceiteAguardandoComContato extends AceiteRow {
  sacado_nome: string;
  valor: number;
  sacado_user_id: number | null;
  sacado_telefone: string | null;
  cedente_id: number | null;
}

// Feeds lib/aceiteReminder.ts's background job — every still-open aceite that hasn't been
// reminded yet, with the sacado's own account (if they've registered) so the reminder can
// actually be sent to a phone number. Deadline filtering (which of these are close enough
// to warrant a reminder) is computed in JS via aceiteSlaStatus, same as everywhere else.
// cedente_id lets the job personalize the reminder with the cedente's white-label brand
// (settings.whitelabelBrand — Integrações ERP) when they've set one up.
export function listAguardandoSemLembrete(): AceiteAguardandoComContato[] {
  return db
    .prepare(
      `SELECT a.*, d.sacado_nome as sacado_nome, d.valor as valor, u.id as sacado_user_id, u.telefone as sacado_telefone, d.cedente_id as cedente_id
       FROM aceites a
       JOIN duplicatas d ON d.id = a.duplicata_id
       LEFT JOIN users u ON u.role = 'sacado' AND lower(u.company_name) = lower(d.sacado_nome)
       WHERE a.status = 'aguardando' AND a.reminder_sent = 0 AND a.prazo_limite IS NOT NULL AND d.sandbox = 0`
    )
    .all() as AceiteAguardandoComContato[];
}

export function markReminderSent(id: number) {
  db.prepare('UPDATE aceites SET reminder_sent = 1 WHERE id = ?').run(id);
}
