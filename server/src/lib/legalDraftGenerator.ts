import { askClaude, claudeEnabled } from './claude.js';
import { logger } from './logger.js';

// Generic legal-draft generator for the lower-stakes documents (LGPD responses, terms
// updates, standalone notices) — same drafting-only, human-reviews-before-sending
// principle as lib/legalCollection.ts, just for content that doesn't need the
// duplicata-specific eligibility gate that module enforces.
export type LegalDraftType = 'resposta_lgpd' | 'termos_atualizacao' | 'notificacao_padrao';

const SYSTEM_BY_TYPE: Record<LegalDraftType, string> = {
  resposta_lgpd: `Você é um assistente jurídico que redige respostas formais a solicitações de titular de dados sob a LGPD (Lei 13.709/2018) para uma plataforma brasileira de duplicatas escriturais. Use linguagem clara e formal, cite apenas os fatos fornecidos no contexto, e estruture como uma resposta real ao titular dos dados. Responda apenas com o texto da resposta, em português.`,
  termos_atualizacao: `Você é um assistente jurídico que redige comunicados de atualização de Termos de Uso/Política de Privacidade para os usuários de uma plataforma brasileira de duplicatas escriturais, com base no resumo de mudanças fornecido no contexto. Responda apenas com o texto do comunicado, em português, claro e direto.`,
  notificacao_padrao: `Você é um assistente jurídico que redige notificações formais diversas (fora do fluxo de cobrança de duplicatas) para uma plataforma brasileira de duplicatas escriturais, com base no contexto fornecido. Responda apenas com o texto da notificação, em português.`,
};

export async function generateLegalDraft(type: LegalDraftType, context: string, userId?: number): Promise<string | null> {
  if (!claudeEnabled) return null;
  try {
    return await askClaude(SYSTEM_BY_TYPE[type], context, 700, { feature: 'legal_draft', userId });
  } catch (err) {
    logger.warn({ err, type }, '[legal-draft] falha ao gerar minuta');
    return null;
  }
}
