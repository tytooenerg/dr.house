import { askClaude, claudeEnabled } from './claude.js';
import { getAceiteByDuplicata } from '../db/aceites.js';
import { getDisputeByAceite } from '../db/disputes.js';
import { parseFlexibleDate, fmtBRL } from './format.js';
import { logger } from './logger.js';
import type { DuplicataRow } from '../db/types.js';

// Cobrança jurídica: a duplicata escritural is a título executivo extrajudicial (Lei
// 5.474/68 art. 15 + CPC art. 784, I) — meaning a real ação de execução can be filed
// directly against an inadimplente sacado, without first needing a full ação de
// conhecimento to prove the debt. This module drafts the documents that escalation
// actually needs. It only ever drafts — nothing here files, sends or protocols anything.
export const LEGAL_DRAFT_DISCLAIMER =
  'Rascunho gerado por inteligência artificial — não constitui aconselhamento jurídico nem substitui a análise de um advogado. Requer revisão e assinatura de advogado inscrito na OAB antes de qualquer uso formal (protocolo judicial, notificação oficial ou envio a terceiros).';

export type CollectionDocType = 'notificacao_cobranca' | 'minuta_protesto' | 'peticao_execucao';

export interface CollectionEligibility {
  eligible: boolean;
  reason?: string;
  diasEmAtraso: number;
}

// Gate is deterministic, computed from real data — never an LLM judgment call. Escalating
// to legal collection only makes sense once: the sacado is actually overdue, they
// confirmed the aceite (so there's no ambiguity about the debt itself), and there's no
// unresolved dispute (which would need to be arbitrated first, not bypassed by escalating
// straight to a demand letter).
export function checkCollectionEligibility(duplicata: DuplicataRow): CollectionEligibility {
  const diasEmAtraso = Math.floor((Date.now() - parseFlexibleDate(duplicata.vencimento).getTime()) / 86_400_000);
  if (diasEmAtraso <= 0) return { eligible: false, reason: 'Duplicata ainda não vencida.', diasEmAtraso };
  const aceite = getAceiteByDuplicata(duplicata.id);
  if (!aceite || aceite.status !== 'aceita') {
    return { eligible: false, reason: 'Aceite não confirmado pelo sacado — cobrança jurídica exige aceite confirmado.', diasEmAtraso };
  }
  const dispute = getDisputeByAceite(aceite.id);
  if (dispute && !dispute.resolved) {
    return { eligible: false, reason: 'Existe disputa em aberto — resolva a disputa antes de escalar para cobrança jurídica.', diasEmAtraso };
  }
  return { eligible: true, diasEmAtraso };
}

const SYSTEM_BY_TYPE: Record<CollectionDocType, string> = {
  notificacao_cobranca: `Você é um assistente jurídico que redige notificações extrajudiciais de cobrança para duplicatas escriturais brasileiras inadimplentes. Use linguagem formal, cite apenas os dados concretos fornecidos (nunca invente nenhum dado), e estruture como uma notificação real: destinatário, referência à duplicata/registro, valor, vencimento, dias em atraso, prazo para pagamento (5 dias úteis) e consequências (protesto e/ou execução judicial em caso de inércia). Não inclua assinatura nem data — isso é preenchido depois por quem revisar. Responda apenas com o texto da notificação, em português.`,
  minuta_protesto: `Você é um assistente jurídico que redige minutas de indicação a protesto de títulos (duplicata escritural, título executivo extrajudicial) para envio a um tabelionato de protesto brasileiro. Cite apenas os dados concretos fornecidos. Estruture com: apresentante, dados do título (número/registro, valor, vencimento, sacado/devedor com CNPJ) e motivo do protesto (falta de pagamento). Responda apenas com o texto da minuta, em português.`,
  peticao_execucao: `Você é um assistente jurídico que redige rascunhos de petição inicial de ação de execução de título extrajudicial (duplicata escritural, fundamento legal: art. 784, I do CPC c/c Lei 5.474/68) para o foro competente brasileiro. Cite apenas os dados concretos fornecidos, nunca invente fatos, jurisprudência ou fundamentos que não foram passados. Estruture com: endereçamento genérico ("AO JUÍZO DE DIREITO DA COMARCA DE [A PREENCHER]"), qualificação das partes com os dados disponíveis (deixe campos ausentes como "[A PREENCHER]"), dos fatos, do direito (natureza de título executivo extrajudicial), do pedido (citação para pagamento em 3 dias sob pena de penhora, valor atualizado). Termine com uma frase deixando claro que os fundamentos legais e o endereçamento devem ser conferidos por um advogado antes do protocolo. Responda apenas com o texto da petição, em português.`,
};

export async function generateCollectionDraft(duplicata: DuplicataRow, type: CollectionDocType, userId?: number): Promise<string | null> {
  if (!claudeEnabled) return null;
  try {
    const aceite = getAceiteByDuplicata(duplicata.id);
    const diasEmAtraso = Math.floor((Date.now() - parseFlexibleDate(duplicata.vencimento).getTime()) / 86_400_000);
    const context = [
      `Duplicata: ${duplicata.id}`,
      `Registro: ${duplicata.registro ?? 'não informado'} (registradora: ${duplicata.registradora ?? 'não informada'})`,
      `Cedente (credor): ${duplicata.cedente_nome}`,
      `Sacado (devedor): ${duplicata.sacado_nome}${duplicata.sacado_cnpj ? ` — CNPJ ${duplicata.sacado_cnpj}` : ''}`,
      `Valor: ${fmtBRL(duplicata.valor)}`,
      `Vencimento: ${duplicata.vencimento} (${diasEmAtraso} dias em atraso)`,
      `Status do aceite: ${aceite ? aceite.status : 'sem registro de aceite'}`,
    ].join('\n');
    return await askClaude(SYSTEM_BY_TYPE[type], context, 900, { feature: 'legal_collection', userId });
  } catch (err) {
    logger.warn({ err, duplicataId: duplicata.id, type }, '[legal-collection] falha ao gerar rascunho');
    return null;
  }
}
