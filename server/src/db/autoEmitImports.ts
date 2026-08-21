import { db } from './index.js';

export type AutoEmitFonte = 'omie' | 'sap' | 'totvs';

export function isAlreadyImported(userId: number, fonte: AutoEmitFonte, externalId: string): boolean {
  const row = db.prepare('SELECT 1 FROM auto_emit_imports WHERE user_id = ? AND fonte = ? AND external_id = ?').get(userId, fonte, externalId);
  return !!row;
}

export function recordAutoEmitImport(userId: number, fonte: AutoEmitFonte, externalId: string, duplicataId: string) {
  db.prepare('INSERT OR IGNORE INTO auto_emit_imports (user_id, fonte, external_id, duplicata_id) VALUES (?, ?, ?, ?)').run(userId, fonte, externalId, duplicataId);
}
