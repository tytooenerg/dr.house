import { db } from './index.js';
import type { AceiteRow } from './types.js';

export function ensureAceite(duplicataId: string, prazoLabel: string): AceiteRow {
  const existing = db.prepare('SELECT * FROM aceites WHERE duplicata_id = ?').get(duplicataId) as AceiteRow | undefined;
  if (existing) return existing;
  db.prepare('INSERT INTO aceites (duplicata_id, prazo_label) VALUES (?, ?)').run(duplicataId, prazoLabel);
  return db.prepare('SELECT * FROM aceites WHERE duplicata_id = ?').get(duplicataId) as AceiteRow;
}

export function getAceite(id: number): AceiteRow | undefined {
  return db.prepare('SELECT * FROM aceites WHERE id = ?').get(id) as AceiteRow | undefined;
}

export function getAceiteByDuplicata(duplicataId: string): AceiteRow | undefined {
  return db.prepare('SELECT * FROM aceites WHERE duplicata_id = ?').get(duplicataId) as AceiteRow | undefined;
}

export function listAceitesByCedente(cedenteId: number): (AceiteRow & { sacado_nome: string; valor: number })[] {
  return db
    .prepare(
      `SELECT a.*, d.sacado_nome as sacado_nome, d.valor as valor FROM aceites a
       JOIN duplicatas d ON d.id = a.duplicata_id
       WHERE d.cedente_id = ? ORDER BY a.created_at DESC`
    )
    .all(cedenteId) as (AceiteRow & { sacado_nome: string; valor: number })[];
}

export function listAceitesBySacadoNome(sacadoNome: string): (AceiteRow & { valor: number; cedente_nome: string })[] {
  return db
    .prepare(
      `SELECT a.*, d.valor as valor, d.cedente_nome as cedente_nome FROM aceites a
       JOIN duplicatas d ON d.id = a.duplicata_id
       WHERE lower(d.sacado_nome) = lower(?) ORDER BY a.created_at DESC`
    )
    .all(sacadoNome) as (AceiteRow & { valor: number; cedente_nome: string })[];
}

export function setAceiteStatus(id: number, status: 'aceita' | 'aguardando' | 'contestada') {
  db.prepare('UPDATE aceites SET status = ? WHERE id = ?').run(status, id);
}
