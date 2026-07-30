import { db } from './index.js';
import type { ComplianceAlertRow, ComplianceAlertSeverity, ComplianceAlertType } from './types.js';

export function createComplianceAlert(input: {
  type: ComplianceAlertType;
  severity: ComplianceAlertSeverity;
  message: string;
  userId?: number | null;
  duplicataId?: string | null;
}): ComplianceAlertRow {
  const info = db
    .prepare('INSERT INTO compliance_alerts (type, severity, message, user_id, duplicata_id) VALUES (?, ?, ?, ?, ?)')
    .run(input.type, input.severity, input.message, input.userId ?? null, input.duplicataId ?? null);
  return db.prepare('SELECT * FROM compliance_alerts WHERE id = ?').get(info.lastInsertRowid) as ComplianceAlertRow;
}

export function listRecentComplianceAlerts(limit = 20): ComplianceAlertRow[] {
  return db.prepare('SELECT * FROM compliance_alerts ORDER BY created_at DESC LIMIT ?').all(limit) as ComplianceAlertRow[];
}

export function countComplianceAlertsSince(hoursAgo: number): { type: ComplianceAlertType; n: number }[] {
  return db
    .prepare(
      `SELECT type, COUNT(*) as n FROM compliance_alerts
       WHERE created_at >= datetime('now', ?) GROUP BY type`
    )
    .all(`-${hoursAgo} hours`) as { type: ComplianceAlertType; n: number }[];
}
