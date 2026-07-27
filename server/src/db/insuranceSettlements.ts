import { db } from './index.js';
import type { InsuranceSettlementRow } from './types.js';

export function recordInsuranceSettlement(input: {
  duplicataId: string;
  investorId: number;
  insurerKey: string;
  premio: number;
  comissaoLastro: number;
  repasseSeguradora: number;
}): InsuranceSettlementRow {
  const info = db
    .prepare(
      `INSERT INTO insurance_settlements (duplicata_id, investor_id, insurer_key, premio, comissao_lastro, repasse_seguradora)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(input.duplicataId, input.investorId, input.insurerKey, input.premio, input.comissaoLastro, input.repasseSeguradora);
  return db.prepare('SELECT * FROM insurance_settlements WHERE id = ?').get(Number(info.lastInsertRowid)) as InsuranceSettlementRow;
}

export function sumInsuranceCommission(): { totalPremios: number; totalComissao: number; totalApolices: number } {
  const row = db
    .prepare('SELECT COUNT(*) as n, COALESCE(SUM(premio), 0) as premios, COALESCE(SUM(comissao_lastro), 0) as comissao FROM insurance_settlements')
    .get() as { n: number; premios: number; comissao: number };
  return { totalPremios: row.premios, totalComissao: row.comissao, totalApolices: row.n };
}
