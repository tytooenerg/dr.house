import { askClaude, claudeEnabled, extractJson } from './claude.js';
import { logger } from './logger.js';
import type { AdvertisementRow } from '../db/advertisements.js';

// Copilot for the admin moderation queue (routes/admin.ts GET /advertisements) — flags
// real problems with a submitted ad for the admin to review before they call
// POST /advertisements/:id/decidir themselves, same human-in-the-loop pattern as
// disputeCopilot/sinistroCopilot. Never decides on its own.
const SYSTEM = `Você ajuda um admin a moderar anúncios submetidos por empresas anunciantes antes de irem ao ar na landing page pública da Lastro (uma plataforma de antecipação de recebíveis via duplicata escritural). Com base apenas no texto e no link fornecidos (nunca invente fatos sobre a empresa), aponte problemas reais: claim exagerado ou enganoso (ex: promessa de rendimento garantido, "sem risco"), linguagem imprópria, ou um link que não parece condizer com um anúncio legítimo.
Responda APENAS com um JSON válido no formato exato:
{"assessment": "ok"|"atencao", "reasoning": "avaliação objetiva em português, 1-2 frases, citando o texto concreto do anúncio"}
Use "atencao" apenas quando houver um problema real e específico no texto/link fornecido. Use "ok" quando não houver nenhum problema aparente.`;

export interface AdAssessment {
  assessment: 'ok' | 'atencao';
  reasoning: string;
}

export async function screenAdvertisement(ad: Pick<AdvertisementRow, 'titulo' | 'texto' | 'link_url'>, userId?: number): Promise<AdAssessment | null> {
  if (!claudeEnabled) return null;
  try {
    const context = [`Título: ${ad.titulo}`, `Texto: ${ad.texto}`, `Link de destino: ${ad.link_url}`].join('\n');
    const text = await askClaude(SYSTEM, context, 300, { feature: 'ad_copilot', userId });
    if (!text) return null;
    const parsed = extractJson<AdAssessment>(text);
    if (!parsed || !['ok', 'atencao'].includes(parsed.assessment)) {
      logger.warn({ text }, '[ad-copilot] resposta não pôde ser interpretada');
      return null;
    }
    return parsed;
  } catch (err) {
    logger.warn({ err }, '[ad-copilot] falha ao gerar triagem');
    return null;
  }
}
