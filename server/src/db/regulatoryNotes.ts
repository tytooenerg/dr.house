import { db } from './index.js';

export interface RegulatoryNoteRow {
  id: number;
  title: string;
  source_text: string;
  summary: string;
  impact_areas_json: string;
  recommended_actions: string;
  submitted_by: number | null;
  acknowledged: number;
  acknowledged_by: number | null;
  acknowledged_at: string | null;
  created_at: string;
}

export function recordRegulatoryNote(opts: {
  title: string;
  sourceText: string;
  summary: string;
  impactAreas: string[];
  recommendedActions: string;
  submittedBy?: number;
}): RegulatoryNoteRow {
  const info = db
    .prepare('INSERT INTO regulatory_notes (title, source_text, summary, impact_areas_json, recommended_actions, submitted_by) VALUES (?, ?, ?, ?, ?, ?)')
    .run(opts.title, opts.sourceText, opts.summary, JSON.stringify(opts.impactAreas), opts.recommendedActions, opts.submittedBy ?? null);
  return db.prepare('SELECT * FROM regulatory_notes WHERE id = ?').get(Number(info.lastInsertRowid)) as RegulatoryNoteRow;
}

export function listRegulatoryNotes(limit = 100): RegulatoryNoteRow[] {
  return db.prepare('SELECT * FROM regulatory_notes ORDER BY created_at DESC LIMIT ?').all(limit) as RegulatoryNoteRow[];
}

export function acknowledgeRegulatoryNote(id: number, userId: number) {
  db.prepare("UPDATE regulatory_notes SET acknowledged = 1, acknowledged_by = ?, acknowledged_at = datetime('now') WHERE id = ?").run(userId, id);
}
