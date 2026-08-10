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
  signature_status: 'none' | 'enviado' | 'assinado';
  signature_envelope_id: string | null;
  signature_url: string | null;
  signer_name: string | null;
  signer_email: string | null;
  signature_sent_at: string | null;
  signature_signed_at: string | null;
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

export function markSentForSignature(id: number, opts: { envelopeId: string; signUrl: string | null; signerName: string; signerEmail: string }) {
  db.prepare(
    "UPDATE legal_documents SET signature_status = 'enviado', signature_envelope_id = ?, signature_url = ?, signer_name = ?, signer_email = ?, signature_sent_at = datetime('now') WHERE id = ?"
  ).run(opts.envelopeId, opts.signUrl, opts.signerName, opts.signerEmail, id);
}

export function markSignatureStatus(id: number, status: 'enviado' | 'assinado') {
  if (status === 'assinado') {
    db.prepare("UPDATE legal_documents SET signature_status = 'assinado', signature_signed_at = datetime('now') WHERE id = ?").run(id);
  } else {
    db.prepare("UPDATE legal_documents SET signature_status = ? WHERE id = ?").run(status, id);
  }
}
