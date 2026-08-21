import { db } from '../db/index.js';
import { listRecentComplianceAlerts } from '../db/complianceAlerts.js';
import { COLORS } from '../data/seed.js';

export interface FraudFlag {
  text: string;
  color: string;
}

// Replaces the old static FRAUD_FLAGS demo copy with a feed computed from real data:
// how many duplicatas were actually scanned in the last 24h, plus any real alerts
// (value anomalies, blocked NF-e reuse attempts) logged by emitirCore during emission.
export function computeFraudFlags(): FraudFlag[] {
  const scanned24h = (
    db.prepare("SELECT COUNT(*) as n FROM duplicatas WHERE created_at >= datetime('now', '-24 hours')").get() as { n: number }
  ).n;
  const alerts = listRecentComplianceAlerts(10).filter((a) => a.type !== 'pld_screening');

  const flags: FraudFlag[] = [
    {
      text: `${scanned24h} duplicata${scanned24h === 1 ? '' : 's'} escaneada${scanned24h === 1 ? '' : 's'} nas últimas 24h — ${alerts.length} alerta${alerts.length === 1 ? '' : 's'} ativo${alerts.length === 1 ? '' : 's'}`,
      color: alerts.length > 0 ? COLORS.AMBER : COLORS.GREEN,
    },
  ];

  for (const a of alerts.slice(0, 4)) {
    flags.push({ text: a.message, color: a.severity === 'critico' ? COLORS.RED : COLORS.AMBER });
  }
  if (alerts.length === 0) {
    flags.push({ text: 'Nenhuma reutilização de NF-e ou valor fora do padrão detectado', color: COLORS.GREEN });
  }
  return flags;
}
