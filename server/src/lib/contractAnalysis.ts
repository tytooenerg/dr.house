import fs from 'node:fs';
import { askClaudeWithDocument, claudeEnabled, extractJson } from './claude.js';
import { logger } from './logger.js';
import type { ContractFlag } from '../db/contractAnalyses.js';

// Replaces the static CONTRACT_FLAGS demo copy on Compliance's "Leitura de contratos"
// card (always the same 3 fixed lines regardless of any real contract) with a real
// Claude read of an uploaded contrato de cessão, flagging clauses that are incompatible
// with a duplicata escritural sale — cláusula de vedação à cessão, exclusividade,
// confidencialidade que impeça registro em CERC/B3/Núclea, etc.
const SYSTEM = `Você é um assistente jurídico que analisa contratos de cessão de crédito/fornecimento no contexto de duplicatas escriturais brasileiras. Identifique cláusulas que possam ser incompatíveis com a cessão/antecipação da duplicata a terceiros: vedação à cessão de crédito, exclusividade com um financiador específico, confidencialidade que impeça o registro em CERC/B3/Núclea/Grafeno, ou outras restrições relevantes.
Responda APENAS com um JSON válido no formato exato:
{"flags": [{"text": "descrição objetiva do achado, em português, 1 frase", "severity": "ok"|"atencao"|"critico"}]}
Inclua pelo menos uma entrada "ok" se nenhuma cláusula problemática for encontrada. Máximo 6 entradas. Nunca invente cláusulas que não estão no texto.`;

export async function analyzeContract(filePath: string, mimeType: string): Promise<ContractFlag[] | null> {
  if (!claudeEnabled) return null;
  try {
    const buffer = fs.readFileSync(filePath);
    const text = await askClaudeWithDocument(
      SYSTEM,
      'Analise este contrato de cessão e responda apenas com o JSON de flags pedido.',
      { buffer, mimeType },
      600
    );
    if (!text) return null;
    const parsed = extractJson<{ flags: ContractFlag[] }>(text);
    if (!parsed || !Array.isArray(parsed.flags)) {
      logger.warn({ text }, '[contract-analysis] resposta da Claude não pôde ser interpretada como JSON de flags');
      return null;
    }
    return parsed.flags.slice(0, 6);
  } catch (err) {
    logger.warn({ err }, '[contract-analysis] falha ao analisar contrato');
    return null;
  }
}
