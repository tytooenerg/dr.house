import { askClaude, claudeEnabled, extractJson } from './claude.js';
import { getAceiteByDuplicata } from '../db/aceites.js';
import { getDisputeByAceite } from '../db/disputes.js';
import { parseFlexibleDate } from './format.js';
import { logger } from './logger.js';
import type { DuplicataRow } from '../db/types.js';

// Copilot for a seguradora deciding a sinistro — NOT an autonomous approve/deny. Flags
// inconsistencies (aceite still pending, an open dispute, unusually short time-to-overdue)
// for the seguradora to review before they call POST /seguradora/sinistro/:id/decidir
// themselves, same human-in-the-loop pattern as the dispute copilot.
const SYSTEM = `Você é um assistente que ajuda uma seguradora a avaliar um pedido de sinistro sobre uma duplicata escritural inadimplente antes da decisão final humana. Com base apenas nos dados fornecidos (nunca invente fatos), aponte inconsistências ou sinais de atenção reais.
Responda APENAS com um JSON válido no formato exato:
{"assessment": "ok"|"atencao"|"critico", "reasoning": "avaliação objetiva em português, 2-3 frases, citando os dados concretos fornecidos"}
Use "critico" apenas quando houver um sinal real de possível fraude ou inconsistência grave (ex: aceite nunca confirmado, disputa em aberto não resolvida). Use "ok" quando os dados não mostrarem nenhuma inconsistência.`;

export interface SinistroAssessment {
  assessment: 'ok' | 'atencao' | 'critico';
  reasoning: string;
}

export async function triageSinistro(duplicata: DuplicataRow, userId?: number): Promise<SinistroAssessment | null> {
  if (!claudeEnabled) return null;
  try {
    const aceite = getAceiteByDuplicata(duplicata.id);
    const dispute = aceite ? getDisputeByAceite(aceite.id) : undefined;
    const diasAtraso = Math.round((Date.now() - parseFlexibleDate(duplicata.vencimento).getTime()) / 86_400_000);

    const context = [
      `Duplicata: ${duplicata.id}`,
      `Cedente: ${duplicata.cedente_nome}`,
      `Sacado: ${duplicata.sacado_nome}`,
      `Valor: ${duplicata.valor}`,
      `Vencimento: ${duplicata.vencimento} (${diasAtraso} dias em atraso)`,
      `Registradora: ${duplicata.registradora ?? 'não informada'}`,
      `Status do aceite: ${aceite ? aceite.status : 'sem registro de aceite'}`,
      dispute ? `Disputa registrada: motivo "${dispute.motivo}", resolvida: ${dispute.resolved ? 'sim' : 'não'}` : 'Nenhuma disputa registrada',
    ].join('\n');

    const text = await askClaude(SYSTEM, context, 350, { feature: 'sinistro_copilot', userId });
    if (!text) return null;
    const parsed = extractJson<SinistroAssessment>(text);
    if (!parsed || !['ok', 'atencao', 'critico'].includes(parsed.assessment)) {
      logger.warn({ text }, '[sinistro-copilot] resposta não pôde ser interpretada');
      return null;
    }
    return parsed;
  } catch (err) {
    logger.warn({ err }, '[sinistro-copilot] falha ao gerar triagem');
    return null;
  }
}
