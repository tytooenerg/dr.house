import { askClaude, claudeEnabled, extractJson } from './claude.js';
import { logger } from './logger.js';

// Deliberately not an automated scraper/feed — there's no single reliable, honest source
// to poll for "every regulatory change that might affect a duplicata escritural platform"
// (BACEN, CVM and COAF each publish independently, in different formats). Instead, an
// admin pastes/uploads the actual normative text (a resolução, circular, instrução
// normativa) and Claude summarizes it + flags impact areas — every note here traces back
// to a real text a human supplied, never a fabricated "we're monitoring this for you"
// claim this repo can't honestly back up.
const SYSTEM = `Você é um assistente jurídico-regulatório especializado em duplicata escritural, PLD/AML e regulação do Banco Central do Brasil (BACEN), analisando normativos para uma plataforma de infraestrutura de recebíveis. Baseie-se apenas no texto fornecido — nunca invente dispositivos, prazos ou obrigações que não estejam explicitamente nele.
Responda APENAS com um JSON válido no formato exato:
{"summary": "resumo objetivo em português, 2-4 frases, do que o normativo determina", "impactAreas": ["área impactada 1", "área impactada 2"], "recommendedActions": "ações recomendadas em português, 1-3 frases, específicas para uma plataforma de duplicata escritural"}`;

export interface RegulatoryAnalysis {
  summary: string;
  impactAreas: string[];
  recommendedActions: string;
}

export async function analyzeRegulatoryText(title: string, text: string, userId?: number): Promise<RegulatoryAnalysis | null> {
  if (!claudeEnabled) return null;
  try {
    const context = `Título/referência: ${title}\n\nTexto normativo:\n${text.slice(0, 12_000)}`;
    const response = await askClaude(SYSTEM, context, 700, { feature: 'regulatory_monitor', userId });
    if (!response) return null;
    const parsed = extractJson<RegulatoryAnalysis>(response);
    if (!parsed || !parsed.summary) {
      logger.warn({ response }, '[regulatory-monitor] resposta não pôde ser interpretada');
      return null;
    }
    return {
      summary: parsed.summary,
      impactAreas: Array.isArray(parsed.impactAreas) ? parsed.impactAreas.slice(0, 8) : [],
      recommendedActions: parsed.recommendedActions || '',
    };
  } catch (err) {
    logger.warn({ err }, '[regulatory-monitor] falha ao analisar texto normativo');
    return null;
  }
}
