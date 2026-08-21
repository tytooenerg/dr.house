import fs from 'node:fs';
import { askClaudeWithDocument, claudeEnabled, extractJson } from './claude.js';
import { logger } from './logger.js';

// Replaces the old hardcoded fake extraction (always returned the same "Grupo Atlas
// Varejo" sample regardless of what was actually uploaded). Reads the real uploaded
// NF-e — PDF/PNG/JPEG via Claude vision, XML directly as structured text (more reliable
// than vision for XML, so it skips the vision pass) — and extracts the fields Emitir
// Duplicata needs. Falls back to null (meaning "couldn't extract, user fills manually")
// when ANTHROPIC_API_KEY isn't set, rather than fabricating plausible-looking data.
const SYSTEM = `Você extrai dados estruturados de notas fiscais eletrônicas (NF-e) brasileiras — XML, PDF ou imagem (DANFE). Responda APENAS com um JSON válido, sem texto adicional, no formato exato:
{"sacado": "razão social do destinatário ou null", "cnpj": "CNPJ do destinatário formatado 00.000.000/0000-00 ou null", "valor": "valor total da nota, formato 0.000,00 ou null", "vencimento": "data de vencimento/pagamento no formato AAAA-MM-DD ou null"}
Se não conseguir identificar um campo com confiança, use null para ele — nunca invente um valor plausível.`;

export interface NfeExtracted {
  sacado: string | null;
  cnpj: string | null;
  valor: string | null;
  vencimento: string | null;
}

export async function extractNfeFields(filePath: string, mimeType: string, userId?: number): Promise<NfeExtracted | null> {
  if (!claudeEnabled) return null;
  try {
    const buffer = fs.readFileSync(filePath);
    const text = await askClaudeWithDocument(
      SYSTEM,
      'Extraia sacado, CNPJ, valor e vencimento desta NF-e e responda apenas com o JSON pedido.',
      { buffer, mimeType },
      300,
      { feature: 'nfe_extraction', userId }
    );
    if (!text) return null;
    const parsed = extractJson<NfeExtracted>(text);
    if (!parsed) {
      logger.warn({ text }, '[nfe-extraction] resposta da Claude não pôde ser interpretada como JSON');
      return null;
    }
    return parsed;
  } catch (err) {
    logger.warn({ err }, '[nfe-extraction] falha ao extrair campos da NF-e');
    return null;
  }
}
