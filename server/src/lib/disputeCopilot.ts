import { askClaude, claudeEnabled, extractJson } from './claude.js';
import { logger } from './logger.js';

// Copilot for admin dispute arbitration — NOT an autonomous decision-maker. Summarizes
// both sides and suggests a verdict + reasoning for the admin to accept, edit or reject;
// the admin still calls POST /admin/disputes/:id/resolve themselves. Computed on-demand
// (button click in the back-office UI) rather than eagerly for every open dispute, since
// a dispute's evidence timeline can grow and recomputing eagerly would be wasted spend.
const SYSTEM = `Você é um assistente que ajuda um analista de compliance a arbitrar uma disputa entre uma empresa cedente e uma empresa sacada sobre uma duplicata escritural. Com base apenas no motivo da disputa e no histórico de mensagens trocadas (nunca invente fatos que não estão no texto fornecido), sugira um veredito e a justificativa.
Responda APENAS com um JSON válido no formato exato:
{"recommendation": "cedente"|"sacado"|"inconclusivo", "reasoning": "justificativa objetiva em português, 2-4 frases, citando elementos concretos do histórico"}
Use "inconclusivo" quando o histórico não tiver evidência suficiente para recomendar um lado com confiança — isso é uma resposta válida e melhor que forçar um veredito sem base.`;

export interface DisputeRecommendation {
  recommendation: 'cedente' | 'sacado' | 'inconclusivo';
  reasoning: string;
}

export async function summarizeDispute(opts: {
  motivo: string;
  sacado: string;
  cedente: string;
  valorFmt: string;
  timeline: { autor: string; texto: string; quando: string }[];
}): Promise<DisputeRecommendation | null> {
  if (!claudeEnabled) return null;
  const context = [
    `Cedente: ${opts.cedente}`,
    `Sacado: ${opts.sacado}`,
    `Valor da duplicata: ${opts.valorFmt}`,
    `Motivo da disputa: ${opts.motivo}`,
    'Histórico de mensagens (ordem cronológica):',
    ...opts.timeline.map((e) => `- [${e.quando}] ${e.autor}: ${e.texto}`),
  ].join('\n');
  try {
    const text = await askClaude(SYSTEM, context, 400);
    if (!text) return null;
    const parsed = extractJson<DisputeRecommendation>(text);
    if (!parsed || !['cedente', 'sacado', 'inconclusivo'].includes(parsed.recommendation)) {
      logger.warn({ text }, '[dispute-copilot] resposta não pôde ser interpretada');
      return null;
    }
    return parsed;
  } catch (err) {
    logger.warn({ err }, '[dispute-copilot] falha ao gerar recomendação');
    return null;
  }
}
