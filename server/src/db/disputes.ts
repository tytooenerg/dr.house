import { db } from './index.js';
import type { DisputeRow } from './types.js';

export function createDispute(aceiteId: number, motivo: string, initialEvent: { autor: string; texto: string }): DisputeRow {
  const info = db.prepare('INSERT INTO disputes (aceite_id, motivo) VALUES (?, ?)').run(aceiteId, motivo);
  const disputeId = Number(info.lastInsertRowid);
  db.prepare('INSERT INTO dispute_events (dispute_id, autor, texto) VALUES (?, ?, ?)').run(disputeId, initialEvent.autor, initialEvent.texto);
  return db.prepare('SELECT * FROM disputes WHERE id = ?').get(disputeId) as DisputeRow;
}

export function getDisputeByAceite(aceiteId: number): DisputeRow | undefined {
  return db.prepare('SELECT * FROM disputes WHERE aceite_id = ? ORDER BY id DESC LIMIT 1').get(aceiteId) as DisputeRow | undefined;
}

export function getDispute(id: number): DisputeRow | undefined {
  return db.prepare('SELECT * FROM disputes WHERE id = ?').get(id) as DisputeRow | undefined;
}

export function listEvents(disputeId: number): { autor: string; texto: string; created_at: string }[] {
  return db.prepare('SELECT autor, texto, created_at FROM dispute_events WHERE dispute_id = ? ORDER BY id ASC').all(disputeId) as {
    autor: string;
    texto: string;
    created_at: string;
  }[];
}

export function setEvidenceStatus(id: number, status: 'enviando' | 'enviada' | null) {
  db.prepare('UPDATE disputes SET evidence_status = ? WHERE id = ?').run(status, id);
}

export function addEvent(disputeId: number, autor: string, texto: string) {
  db.prepare('INSERT INTO dispute_events (dispute_id, autor, texto) VALUES (?, ?, ?)').run(disputeId, autor, texto);
}

export function resolveDispute(id: number, resolution = '', resolvedBy: number | null = null) {
  db.prepare("UPDATE disputes SET resolved = 1, resolution = ?, resolved_by = ?, resolved_at = datetime('now') WHERE id = ?").run(
    resolution,
    resolvedBy,
    id
  );
}

// Disputes have no v1 partner-API surface (internal SPA + admin only), so unlike
// aceites/duplicatas these always operate on the live data plane — a dispute raised
// against a sandbox aceite (created by a test-mode key contesting its own seeded data)
// never leaks into a real cedente's Disputas screen or the admin arbitration queue.
export function listOpenDisputesByCedente(cedenteId: number) {
  return db
    .prepare(
      `SELECT dis.*, a.duplicata_id as duplicata_id, d.sacado_nome as sacado_nome, d.valor as valor
       FROM disputes dis
       JOIN aceites a ON a.id = dis.aceite_id
       JOIN duplicatas d ON d.id = a.duplicata_id
       WHERE d.cedente_id = ? AND d.sandbox = 0 AND dis.resolved = 0
       ORDER BY dis.created_at DESC`
    )
    .all(cedenteId) as (DisputeRow & { duplicata_id: string; sacado_nome: string; valor: number })[];
}

export function listAllOpenDisputes() {
  return db
    .prepare(
      `SELECT dis.*, a.duplicata_id as duplicata_id, d.sacado_nome as sacado_nome, d.cedente_nome as cedente_nome, d.valor as valor
       FROM disputes dis
       JOIN aceites a ON a.id = dis.aceite_id
       JOIN duplicatas d ON d.id = a.duplicata_id
       WHERE dis.resolved = 0 AND d.sandbox = 0
       ORDER BY dis.created_at ASC`
    )
    .all() as (DisputeRow & { duplicata_id: string; sacado_nome: string; cedente_nome: string; valor: number })[];
}
