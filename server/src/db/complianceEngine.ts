import { db } from './index.js';

export interface ComplianceBreakdownItem {
  fator: string;
  pontos: number;
  detalhe: string;
}

export interface ComplianceEngineResultRow {
  id: number;
  duplicata_id: string;
  score: number;
  breakdown_json: string;
  reasoning: string;
  decision: 'auto_aprovado' | 'suspenso_para_revisao';
  reviewed: number;
  review_decision: 'liberado' | 'rejeitado' | null;
  review_note: string | null;
  reviewed_by: number | null;
  reviewed_at: string | null;
  created_at: string;
}

export function recordComplianceResult(opts: {
  duplicataId: string;
  score: number;
  breakdown: ComplianceBreakdownItem[];
  reasoning: string;
  decision: 'auto_aprovado' | 'suspenso_para_revisao';
}) {
  db.prepare(
    'INSERT INTO compliance_engine_results (duplicata_id, score, breakdown_json, reasoning, decision) VALUES (?, ?, ?, ?, ?)'
  ).run(opts.duplicataId, opts.score, JSON.stringify(opts.breakdown), opts.reasoning, opts.decision);
}

export function getComplianceResult(duplicataId: string): ComplianceEngineResultRow | undefined {
  return db.prepare('SELECT * FROM compliance_engine_results WHERE duplicata_id = ? ORDER BY id DESC LIMIT 1').get(duplicataId) as
    | ComplianceEngineResultRow
    | undefined;
}

/**
 * A fila de revisão HUMANA de compliance.
 *
 * Achado (teste de operação real, scripts/operacao-real): esta consulta filtrava só por
 * `reviewed = 0`, e o motor grava uma linha para TODA emissão — inclusive as que ele mesmo
 * liberou (`decision = 'auto_aprovado'`). Como `resolveComplianceReview` só é alcançável
 * pelo POST /admin/compliance-queue/:id/decidir, que exige `status = 'suspensa_compliance'`,
 * uma duplicata auto-aprovada entrava na fila e não tinha como sair NUNCA: nenhum endpoint
 * conseguia marcá-la revisada. A fila crescia uma linha por emissão, para sempre.
 *
 * O efeito não é cosmético: o "Compliance pendente" do back-office e o do painel do auditor
 * saem daqui. Na operação real, o painel do auditor mostrava como pendente de revisão uma
 * duplicata já emitida, aceita, leiloada, vendida no balcão e PAGA — e ao lado dela, um dia,
 * estaria a única que de fato precisava de um humano, indistinguível no meio do resto.
 *
 * `reviewed = 0` continua correto no registro: ninguém reviu mesmo. O erro era tratar "nenhum
 * humano olhou" como "algum humano precisa olhar". Quem espera revisão é só quem o motor
 * suspendeu.
 */
export function listPendingComplianceReview(): (ComplianceEngineResultRow & {
  sacado_nome: string;
  cedente_nome: string;
  valor: number;
  vencimento: string;
})[] {
  return db
    .prepare(
      `SELECT cer.*, d.sacado_nome as sacado_nome, d.cedente_nome as cedente_nome, d.valor as valor, d.vencimento as vencimento
       FROM compliance_engine_results cer
       JOIN duplicatas d ON d.id = cer.duplicata_id
       WHERE cer.reviewed = 0 AND cer.decision = 'suspenso_para_revisao'
       ORDER BY cer.created_at ASC`
    )
    .all() as (ComplianceEngineResultRow & { sacado_nome: string; cedente_nome: string; valor: number; vencimento: string })[];
}

export function resolveComplianceReview(duplicataId: string, decision: 'liberado' | 'rejeitado', note: string, reviewedBy: number) {
  db.prepare(
    "UPDATE compliance_engine_results SET reviewed = 1, review_decision = ?, review_note = ?, reviewed_by = ?, reviewed_at = datetime('now') WHERE duplicata_id = ? AND reviewed = 0"
  ).run(decision, note, reviewedBy, duplicataId);
}
