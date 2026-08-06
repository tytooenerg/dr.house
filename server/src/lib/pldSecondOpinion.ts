import { askClaude, claudeEnabled, extractJson } from './claude.js';
import { logger } from './logger.js';

// Every PLD screening source in db/sanctions.ts (paid provider, OFAC live feed, demo
// table) matches by substring — good recall, poor precision (e.g. "Silva Comércio Ltda"
// could substring-match a sanctioned "Silva" with nothing else in common). This adds a
// second opinion before a match becomes an actual KYB flag: Claude judges whether the
// queried company name and the matched sanctions-list entry plausibly refer to the same
// real entity, given only the names and match source (never invents outside knowledge).
// Only ever narrows a match to "not flagged" — never widens or invents a new match — and
// only when ANTHROPIC_API_KEY is configured; unconfigured or on failure, the original
// substring match still stands exactly as before this feature existed.
const SYSTEM = `Você avalia se duas menções de nome de empresa/pessoa provavelmente se referem à mesma entidade real, para reduzir falsos positivos em triagem de PLD/sanções. Considere apenas os nomes fornecidos — não invente informação externa sobre nenhuma das partes.
Responda APENAS com um JSON válido no formato exato:
{"sameEntity": true|false, "reasoning": "justificativa objetiva em português, 1 frase"}
Marque "sameEntity": false apenas quando os nomes coincidirem por um trecho genérico/comum (um sobrenome isolado, uma palavra genérica do ramo) sem outros elementos correspondentes — na dúvida real, prefira true (falso positivo é mais seguro que falso negativo em triagem de sanções).`;

export async function isPlausiblySameEntity(queriedName: string, matchedName: string, matchSource: string, userId?: number): Promise<boolean> {
  if (!claudeEnabled) return true; // no second opinion available — keep the original match standing
  try {
    const context = `Nome consultado: "${queriedName}"\nNome encontrado na lista (${matchSource}): "${matchedName}"`;
    const text = await askClaude(SYSTEM, context, 200, { feature: 'pld_second_opinion', userId });
    if (!text) return true;
    const parsed = extractJson<{ sameEntity: boolean; reasoning: string }>(text);
    if (!parsed) return true;
    if (!parsed.sameEntity) {
      logger.info({ queriedName, matchedName, matchSource, reasoning: parsed.reasoning }, '[pld-second-opinion] match descartado como coincidência de nome');
    }
    return parsed.sameEntity;
  } catch (err) {
    logger.warn({ err }, '[pld-second-opinion] falha ao consultar segunda opinião — mantendo o match original');
    return true;
  }
}
