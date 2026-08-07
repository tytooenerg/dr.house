import { db } from './index.js';

export interface ForeignInvestorScreeningRow {
  id: number;
  user_id: number;
  pais_domicilio: string;
  jurisdicao_favorecida: number;
  classificacao_investidor: 'profissional' | 'qualificado' | 'nao_classificado';
  representante_legal: string;
  pld_status: 'clear' | 'flagged';
  pld_detail: string;
  memo: string;
  generated_by: number | null;
  created_at: string;
}

export function recordForeignInvestorScreening(input: {
  userId: number;
  paisDomicilio: string;
  jurisdicaoFavorecida: boolean;
  classificacaoInvestidor: 'profissional' | 'qualificado' | 'nao_classificado';
  representanteLegal: string;
  pldStatus: 'clear' | 'flagged';
  pldDetail: string;
  memo: string;
  generatedBy?: number;
}): ForeignInvestorScreeningRow {
  const info = db
    .prepare(
      `INSERT INTO foreign_investor_screenings
       (user_id, pais_domicilio, jurisdicao_favorecida, classificacao_investidor, representante_legal, pld_status, pld_detail, memo, generated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.userId,
      input.paisDomicilio,
      input.jurisdicaoFavorecida ? 1 : 0,
      input.classificacaoInvestidor,
      input.representanteLegal,
      input.pldStatus,
      input.pldDetail,
      input.memo,
      input.generatedBy ?? null
    );
  return db.prepare('SELECT * FROM foreign_investor_screenings WHERE id = ?').get(Number(info.lastInsertRowid)) as ForeignInvestorScreeningRow;
}

export function listForeignInvestorScreeningsByUser(userId: number): ForeignInvestorScreeningRow[] {
  return db.prepare('SELECT * FROM foreign_investor_screenings WHERE user_id = ? ORDER BY created_at DESC').all(userId) as ForeignInvestorScreeningRow[];
}

export function getLatestForeignInvestorScreening(userId: number): ForeignInvestorScreeningRow | undefined {
  return db.prepare('SELECT * FROM foreign_investor_screenings WHERE user_id = ? ORDER BY created_at DESC LIMIT 1').get(userId) as
    | ForeignInvestorScreeningRow
    | undefined;
}
