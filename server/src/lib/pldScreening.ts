import { screenEntity } from '../db/sanctions.js';
import { setPldStatus } from '../db/users.js';
import { createComplianceAlert } from '../db/complianceAlerts.js';
import { recordAuditEvent } from '../db/audit.js';

// Runs at KYB submission time (Circular BCB 3.978/2020 requires client screening by
// risk before onboarding). Checks the real public OFAC SDN list when SANCTIONS_LIVE_FEED
// is set (see lib/sanctionsFeed.ts), plus the labeled demonstration watchlist as a
// fallback/supplement — see db/sanctions.ts for exactly which source flagged a given hit.
export async function runPldScreening(userId: number, companyName: string, cnpj: string) {
  const match = await screenEntity(companyName, cnpj);
  if (!match) {
    setPldStatus(userId, 'clear', '');
    return { flagged: false as const };
  }
  const fonteLabel = match.fonte === 'provedor_pld' ? 'provedor de PLD contratado' : match.fonte === 'ofac' ? 'lista OFAC (real)' : 'lista de demonstração';
  const note = `Possível correspondência em ${fonteLabel} (${match.tipo === 'sancao' ? 'sanção' : 'PEP'}): ${match.nome}`;
  setPldStatus(userId, 'flagged', note);
  createComplianceAlert({ type: 'pld_screening', severity: 'critico', message: note, userId });
  recordAuditEvent(userId, companyName, 'kyb.pld_screening_flagged', { match: match.nome, tipo: match.tipo, fonte: match.fonte });
  return { flagged: true as const, note };
}
