import { getDuplicata } from '../db/duplicatas.js';
import { computeLiquiditySignalForRating, BASE_RATE_BANDS } from './dynamicPricing.js';
import { ratingFromScore } from './riscoCore.js';
import { estimateDefaultProbability } from './defaultProbability.js';
import { getRegistradora } from './registradoras.js';
import { fmtBRL } from './format.js';
import { askClaude, claudeEnabled } from './claude.js';

// "Por que essa oferta?" — the funding-matching explainability the master prompt asked
// for. Every factor here already drives the real deságio/score shown elsewhere
// (dynamicPricing.ts, riscoCore.ts) — this module doesn't compute anything new, it just
// assembles the existing real signals into a explanation a cedente/investidor can read,
// instead of a bare number with no reasoning attached.
export interface FundingExplanationFactor {
  label: string;
  valor: string;
  peso: 'alto' | 'médio' | 'informativo';
}

export interface FundingExplanation {
  duplicataId: string;
  rating: string;
  factors: FundingExplanationFactor[];
  resumo: string;
  narrativaIA: string | null;
}

export async function explainFundingOffer(duplicataId: string, userId?: number): Promise<FundingExplanation | null> {
  const d = getDuplicata(duplicataId);
  if (!d) return null;

  const score = d.score ?? 60;
  const rating = ratingFromScore(score);
  const [minBand, maxBand] = BASE_RATE_BANDS[rating];
  // Scoped to this offer's own rating bucket when there's enough real 30d volume in it to
  // trust (falls back to the platform-wide signal — signal.segmented tells the caller
  // which happened — rather than reporting a number this codebase doesn't trust yet).
  const liquidity = computeLiquiditySignalForRating(rating);
  const pd = estimateDefaultProbability(d);
  const registradora = getRegistradora(d.registro);

  const factors: FundingExplanationFactor[] = [
    { label: 'Score de risco do sacado', valor: `${score}/100 (rating ${rating})`, peso: 'alto' },
    { label: 'Probabilidade de default estimada', valor: `${(pd.pd * 100).toFixed(1)}% (${pd.source === 'ml' ? 'modelo treinado' : 'prior assumido por rating'})`, peso: 'alto' },
    { label: 'Faixa de deságio base para este rating', valor: `${minBand.toFixed(1)}% – ${maxBand.toFixed(1)}% a.m.`, peso: 'alto' },
    {
      label: `Condição de mercado (rating ${rating}, 30 dias)`,
      valor:
        liquidity.ratio === Infinity
          ? 'demanda muito acima da oferta recente — taxas comprimidas'
          : `multiplicador ${liquidity.multiplier.toFixed(2)}x sobre a faixa base (oferta ${fmtBRL(liquidity.supply30dBRL)} × demanda ${fmtBRL(liquidity.demand30dBRL)}${liquidity.segmented ? `, apenas rating ${rating}` : ', mercado inteiro — volume recente do rating ainda é baixo demais para segmentar com confiança'})`,
      peso: 'médio',
    },
    { label: 'Seguro contratado', valor: d.seguro ? 'sim — reduz a perda esperada em caso de inadimplência' : 'não contratado', peso: 'médio' },
    {
      label: 'Registradora',
      valor: registradora ? `${registradora.name} (confiabilidade observada ${registradora.confiabilidadePct}%)` : 'ainda não registrada',
      peso: 'informativo',
    },
  ];

  const resumo = buildRuleBasedSummary(d.desagio, rating, liquidity.multiplier, d.seguro === 1);
  const narrativaIA = claudeEnabled ? await tryAiNarrative(factors, resumo, userId) : null;

  return { duplicataId, rating, factors, resumo, narrativaIA };
}

function buildRuleBasedSummary(desagio: string | null, rating: string, liquidityMultiplier: number, segurado: boolean): string {
  const parts = [
    `O deságio${desagio ? ` de ${desagio}` : ''} reflete principalmente o rating ${rating} do sacado`,
    liquidityMultiplier > 1.02
      ? 'em um momento de mercado apertado (mais capital disputando oferta do que duplicatas novas entrando)'
      : liquidityMultiplier < 0.98
        ? 'em um momento de mercado com oferta abundante (taxas mais largas para atrair capital)'
        : 'em condição de mercado neutra',
    segurado ? 'com o risco de crédito parcialmente coberto por seguro' : 'sem cobertura de seguro contratada',
  ];
  return `${parts[0]}, ${parts[1]}, ${parts[2]}.`;
}

const EXPLAIN_SYSTEM = `Você explica, em português do Brasil e em até 3 frases, por que uma oferta de antecipação de duplicata na Lastro tem o preço/deságio que tem, para um cedente ou investidor não-técnico. Use só os fatores fornecidos, não invente números novos. Seja direto, sem jargão desnecessário.`;

async function tryAiNarrative(factors: FundingExplanationFactor[], resumo: string, userId?: number): Promise<string | null> {
  try {
    const context = `Resumo determinístico: ${resumo}\nFatores:\n${factors.map((f) => `- ${f.label}: ${f.valor} (peso ${f.peso})`).join('\n')}`;
    return await askClaude(EXPLAIN_SYSTEM, context, 220, { feature: 'funding_explain', userId });
  } catch {
    return null;
  }
}
