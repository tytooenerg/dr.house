import { screenEntity } from '../db/sanctions.js';
import { setPldStatus } from '../db/users.js';
import { createComplianceAlert } from '../db/complianceAlerts.js';
import { recordAuditEvent } from '../db/audit.js';

// Runs at KYB submission time (Circular BCB 3.978/2020 requires client screening by
// risk before onboarding). Demonstration-only match source — see db/sanctions.ts.
export function runPldScreening(userId: number, companyName: string, cnpj: string) {
  const match = screenEntity(companyName, cnpj);
  if (!match) {
    setPldStatus(userId, 'clear', '');
    return { flagged: false as const };
  }
  const note = `Possível correspondência em lista de demonstração (${match.tipo === 'sancao' ? 'sanção' : 'PEP'}): ${match.nome}`;
  setPldStatus(userId, 'flagged', note);
  createComplianceAlert({ type: 'pld_screening', severity: 'critico', message: note, userId });
  recordAuditEvent(userId, companyName, 'kyb.pld_screening_flagged', { match: match.nome, tipo: match.tipo });
  return { flagged: true as const, note };
}
