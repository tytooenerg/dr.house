import { db } from './index.js';

export type LegalDocumentType = 'notificacao_cobranca' | 'minuta_protesto' | 'peticao_execucao' | 'resposta_lgpd' | 'termos_atualizacao' | 'notificacao_padrao';

export interface LegalDocumentRow {
  id: number;
  type: LegalDocumentType;
  duplicata_id: string | null;
  content: string;
  generated_by: number | null;
  reviewed: number;
  reviewed_by: number | null;
  reviewed_at: string | null;
  created_at: string;
}

export function recordLegalDocument(opts: { type: LegalDocumentType; duplicataId?: string | null; content: string; generatedBy?: number }): LegalDocumentRow {
  const info = db
    .prepare('INSERT INTO legal_documents (type, duplicata_id, content, generated_by) VALUES (?, ?, ?, ?)')
    .run(opts.type, opts.duplicataId ?? null, opts.content, opts.generatedBy ?? null);
  return db.prepare('SELECT * FROM legal_documents WHERE id = ?').get(Number(info.lastInsertRowid)) as LegalDocumentRow;
}

export function listLegalDocumentsByDuplicata(duplicataId: string): LegalDocumentRow[] {
  return db.prepare('SELECT * FROM legal_documents WHERE duplicata_id = ? ORDER BY created_at DESC').all(duplicataId) as LegalDocumentRow[];
}

// General-purpose drafts (LGPD responses, terms updates, standalone notices) aren't tied
// to any duplicata.
export function listGeneralLegalDocuments(limit = 100): LegalDocumentRow[] {
  return db.prepare('SELECT * FROM legal_documents WHERE duplicata_id IS NULL ORDER BY created_at DESC LIMIT ?').all(limit) as LegalDocumentRow[];
}

export function getLegalDocument(id: number): LegalDocumentRow | undefined {
  return db.prepare('SELECT * FROM legal_documents WHERE id = ?').get(id) as LegalDocumentRow | undefined;
}

export function markLegalDocumentReviewed(id: number, reviewedBy: number) {
  db.prepare("UPDATE legal_documents SET reviewed = 1, reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?").run(reviewedBy, id);
}
