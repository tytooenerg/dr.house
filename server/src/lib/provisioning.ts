import { db } from '../db/index.js';
import { fmtBRL, parseFlexibleDate } from './format.js';

// Res. CMN 4.966/2022 provisioning stages, computed for the financiador's own book —
// each active (not yet resold) purchase whose duplicata vencimento has passed is a
// proxy for "not yet repaid by the sacado", the same signal the marketplace already
// uses for the transparency page's inadimplência rate and for sinistro eligibility.
export type ProvisioningStage = 'estagio_1' | 'estagio_2' | 'estagio_3';

export interface ProvisioningRow {
  duplicataId: string;
  sacadoNome: string;
  valorFmt: string;
  vencimento: string;
  diasAtraso: number;
  estagio: ProvisioningStage;
}

function stageFor(diasAtraso: number): ProvisioningStage {
  if (diasAtraso <= 30) return 'estagio_1';
  if (diasAtraso <= 90) return 'estagio_2';
  return 'estagio_3';
}

export function computeProvisioning(investorId: number): { rows: ProvisioningRow[]; summary: Record<ProvisioningStage, number> } {
  const positions = db
    .prepare(
      `SELECT p.duplicata_id as duplicataId, d.sacado_nome as sacadoNome, d.valor as valor, d.vencimento as vencimento
       FROM purchases p JOIN duplicatas d ON d.id = p.duplicata_id
       WHERE p.investor_id = ? AND p.active = 1`
    )
    .all(investorId) as { duplicataId: string; sacadoNome: string; valor: number; vencimento: string }[];

  const now = Date.now();
  const rows: ProvisioningRow[] = positions.map((p) => {
    const vencMs = parseFlexibleDate(p.vencimento).getTime();
    const diasAtraso = Math.max(0, Math.floor((now - vencMs) / 86_400_000));
    return {
      duplicataId: p.duplicataId,
      sacadoNome: p.sacadoNome,
      valorFmt: fmtBRL(p.valor),
      vencimento: p.vencimento,
      diasAtraso,
      estagio: stageFor(diasAtraso),
    };
  });

  const summary: Record<ProvisioningStage, number> = { estagio_1: 0, estagio_2: 0, estagio_3: 0 };
  for (const r of rows) summary[r.estagio]++;

  return { rows, summary };
}
