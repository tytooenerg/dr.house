import { db } from '../db/index.js';
import { sacadoValorStats } from '../db/duplicatas.js';
import { findSacadoByCnpj } from './riscoCore.js';
import { askClaude, claudeEnabled } from './claude.js';
import { fmtBRL } from './format.js';
import { logger } from './logger.js';
import type { ComplianceBreakdownItem } from '../db/complianceEngine.js';
import type { UserRow } from '../db/types.js';

// Unified Compliance AI Engine — combines signals that already existed on separate
// screens (duplicidade check, PLD status, valor anômalo, score do sacado) into one
// score per duplicata at emissão. The score is always a deterministic, auditable
// formula over real data — never an LLM free-floating number — because a
// compliance-critical score needs to be reproducible with or without an API key.
// Claude's only role here is generating the human-readable reasoning a reviewer sees;
// it never changes the score or the suspend/approve decision itself.
export const SUSPEND_THRESHOLD = 80;

export interface ComplianceEngineOutcome {
  score: number;
  breakdown: ComplianceBreakdownItem[];
  decision: 'auto_aprovado' | 'suspenso_para_revisao';
  reasoning: string;
}

function computeDeterministicScore(opts: {
  duplicataId: string;
  sacadoNome: string;
  sacadoCnpj: string;
  valor: number;
  vencimento: string;
  cedenteId: number;
  cedente: UserRow;
}): ComplianceBreakdownItem[] {
  const breakdown: ComplianceBreakdownItem[] = [];

  // Duplicidade real dentro da base da Lastro: mesmo sacado+valor+vencimento já
  // registrado por outro cedente é o padrão clássico de financiamento duplicado.
  if (opts.sacadoCnpj) {
    const digits = opts.sacadoCnpj.replace(/\D/g, '');
    const others = db
      .prepare(
        `SELECT COUNT(DISTINCT cedente_id) as n FROM duplicatas
         WHERE id != ? AND valor = ? AND vencimento = ?
         AND REPLACE(REPLACE(REPLACE(sacado_cnpj, '.', ''), '-', ''), '/', '') = ?
         AND cedente_id != ?`
      )
      .get(opts.duplicataId, opts.valor, opts.vencimento, digits, opts.cedenteId) as { n: number };
    if (others.n > 0) {
      breakdown.push({ fator: 'Duplicidade', pontos: 40, detalhe: `Mesmo valor/vencimento já registrado por ${others.n} outro(s) cedente(s) para este sacado` });
    }
  }

  // PLD: cedente já sinalizado em triagem de sanções/PEP na submissão de KYB.
  if (opts.cedente.pld_status === 'flagged') {
    breakdown.push({ fator: 'PLD', pontos: 35, detalhe: `Cedente com triagem de PLD sinalizada: ${opts.cedente.pld_match_note || 'ver detalhes no KYB'}` });
  }

  // Valor anômalo: 3x+ acima da média histórica para este sacado (mesmo cálculo já
  // usado para o alerta de compliance no momento da emissão).
  if (opts.sacadoCnpj) {
    const stats = sacadoValorStats(opts.sacadoCnpj);
    if (stats.n >= 3 && opts.valor > stats.avg * 3) {
      breakdown.push({ fator: 'Valor anômalo', pontos: 20, detalhe: `${fmtBRL(opts.valor)} é 3x+ acima da média histórica (${fmtBRL(stats.avg)}) para este sacado` });
    }
  }

  // Score do sacado: rating baixo pesa moderadamente — não é fraude, mas é risco de
  // crédito real que deveria receber um segundo olhar antes de ir a leilão.
  const sacadoMatch = findSacadoByCnpj(opts.sacadoCnpj);
  const rating = sacadoMatch?.sacado.rating;
  if (rating === 'C') breakdown.push({ fator: 'Score do sacado', pontos: 15, detalhe: 'Sacado com rating C na base interna' });
  else if (rating === 'B') breakdown.push({ fator: 'Score do sacado', pontos: 8, detalhe: 'Sacado com rating B na base interna' });
  else if (!rating) breakdown.push({ fator: 'Score do sacado', pontos: 5, detalhe: 'Sacado sem histórico — sem base para avaliar risco de crédito' });

  return breakdown;
}

const REASONING_SYSTEM = `Você explica, para um analista de compliance humano, por que uma duplicata escritural recebeu determinada nota de risco automática — com base apenas nos fatores concretos fornecidos, sem inventar nenhuma informação adicional.
Responda em português, 2-4 frases, direto, citando os fatores reais fornecidos. Não repita a lista crua — sintetize.`;

export async function runComplianceEngine(opts: {
  duplicataId: string;
  sacadoNome: string;
  sacadoCnpj: string;
  valor: number;
  vencimento: string;
  cedenteId: number;
  cedente: UserRow;
}): Promise<ComplianceEngineOutcome> {
  const breakdown = computeDeterministicScore(opts);
  const score = Math.min(100, breakdown.reduce((sum, b) => sum + b.pontos, 0));
  const decision: ComplianceEngineOutcome['decision'] = score >= SUSPEND_THRESHOLD ? 'suspenso_para_revisao' : 'auto_aprovado';

  let reasoning: string;
  if (breakdown.length === 0) {
    reasoning = 'Nenhum fator de risco identificado pelos controles automáticos — duplicidade, PLD, valor e score do sacado dentro do esperado.';
  } else {
    const factList = breakdown.map((b) => `${b.fator} (+${b.pontos}): ${b.detalhe}`).join('\n');
    const generated = claudeEnabled
      ? await askClaude(REASONING_SYSTEM, `Nota final: ${score}/100.\nFatores:\n${factList}`, 300).catch((err) => {
          logger.warn({ err }, '[compliance-engine] falha ao gerar explicação via Claude');
          return null;
        })
      : null;
    reasoning = generated || `Fatores identificados: ${breakdown.map((b) => `${b.fator} (+${b.pontos} pts — ${b.detalhe})`).join('; ')}.`;
  }

  return { score, breakdown, decision, reasoning };
}
