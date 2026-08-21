import { db } from './index.js';

export type SarTipo = 'fracionamento' | 'entrada_saida_rapida';
export type SarSeveridade = 'atencao' | 'critico';
export type SarStatus = 'aberto' | 'descartado' | 'reportado_coaf';

export interface SuspiciousActivityReportRow {
  id: number;
  user_id: number;
  tipo: SarTipo;
  severidade: SarSeveridade;
  descricao: string;
  evidencia: string;
  status: SarStatus;
  external_reference: string | null;
  review_note: string | null;
  reviewed_by: number | null;
  reviewed_at: string | null;
  created_at: string;
}

export function hasRecentOpenReport(userId: number, tipo: SarTipo, sinceHours: number): boolean {
  const row = db
    .prepare(
      `SELECT COUNT(*) as n FROM suspicious_activity_reports
       WHERE user_id = ? AND tipo = ? AND status = 'aberto' AND created_at >= datetime('now', ?)`
    )
    .get(userId, tipo, `-${sinceHours} hours`) as { n: number };
  return row.n > 0;
}

export function createSuspiciousActivityReport(input: {
  userId: number;
  tipo: SarTipo;
  severidade: SarSeveridade;
  descricao: string;
  evidencia: unknown;
}): SuspiciousActivityReportRow {
  const info = db
    .prepare('INSERT INTO suspicious_activity_reports (user_id, tipo, severidade, descricao, evidencia) VALUES (?, ?, ?, ?, ?)')
    .run(input.userId, input.tipo, input.severidade, input.descricao, JSON.stringify(input.evidencia));
  return db.prepare('SELECT * FROM suspicious_activity_reports WHERE id = ?').get(info.lastInsertRowid) as SuspiciousActivityReportRow;
}

export function getSuspiciousActivityReport(id: number): SuspiciousActivityReportRow | undefined {
  return db.prepare('SELECT * FROM suspicious_activity_reports WHERE id = ?').get(id) as SuspiciousActivityReportRow | undefined;
}

export function listSuspiciousActivityReports(status?: SarStatus): (SuspiciousActivityReportRow & { company_name: string; email: string })[] {
  if (status) {
    return db
      .prepare(
        `SELECT s.*, u.company_name as company_name, u.email as email FROM suspicious_activity_reports s
         JOIN users u ON u.id = s.user_id WHERE s.status = ? ORDER BY s.created_at DESC`
      )
      .all(status) as (SuspiciousActivityReportRow & { company_name: string; email: string })[];
  }
  return db
    .prepare(
      `SELECT s.*, u.company_name as company_name, u.email as email FROM suspicious_activity_reports s
       JOIN users u ON u.id = s.user_id ORDER BY s.created_at DESC`
    )
    .all() as (SuspiciousActivityReportRow & { company_name: string; email: string })[];
}

export function dismissSuspiciousActivityReport(id: number, adminId: number, note?: string) {
  db.prepare(
    "UPDATE suspicious_activity_reports SET status = 'descartado', reviewed_by = ?, reviewed_at = datetime('now'), review_note = ? WHERE id = ? AND status = 'aberto'"
  ).run(adminId, note ?? null, id);
}

export function markSuspiciousActivityReported(id: number, adminId: number, externalReference: string, note?: string) {
  db.prepare(
    "UPDATE suspicious_activity_reports SET status = 'reportado_coaf', reviewed_by = ?, reviewed_at = datetime('now'), external_reference = ?, review_note = ? WHERE id = ? AND status = 'aberto'"
  ).run(adminId, externalReference, note ?? null, id);
}
