import fs from 'node:fs';
import { askClaudeWithDocument, claudeEnabled, extractJson } from './claude.js';
import { logger } from './logger.js';

// Extração de NFS-e (nota fiscal de SERVIÇO) — gêmea de lib/nfeExtraction.ts, mas não é um
// find-and-replace de "produto" por "serviço": NFS-e não tem um layout nacional único como
// o DANFE da NF-e. Cada município (ABRASF é o padrão mais comum, mas não universal) emite
// no seu próprio formato, com "tomador do serviço" no lugar de "destinatário" e, em geral,
// sem data de vencimento explícita na nota (quem define isso é o contrato/pedido, não a
// NFS-e) — por isso vencimento aqui é o campo que mais frequentemente volta null, e por
// isso mesmo o formulário continua exigindo que o cedente confirme/preencha manualmente.
const SYSTEM = `Você extrai dados estruturados de notas fiscais de serviço eletrônicas (NFS-e) brasileiras — XML, PDF ou imagem. O layout varia por município (não existe um padrão nacional único como o DANFE da NF-e). Responda APENAS com um JSON válido, sem texto adicional, no formato exato:
{"sacado": "razão social do tomador do serviço ou null", "cnpj": "CNPJ do tomador formatado 00.000.000/0000-00 ou null", "valor": "valor total dos serviços, formato 0.000,00 ou null", "vencimento": "data de vencimento/pagamento no formato AAAA-MM-DD, se houver explicitamente na nota, ou null"}
Se não conseguir identificar um campo com confiança, use null para ele — nunca invente um valor plausível. NFS-e raramente traz vencimento explícito; é normal e esperado retornar null para esse campo.`;

export interface NfseExtracted {
  sacado: string | null;
  cnpj: string | null;
  valor: string | null;
  vencimento: string | null;
}

export async function extractNfseFields(filePath: string, mimeType: string, userId?: number): Promise<NfseExtracted | null> {
  if (!claudeEnabled) return null;
  try {
    const buffer = fs.readFileSync(filePath);
    const text = await askClaudeWithDocument(
      SYSTEM,
      'Extraia o tomador do serviço, CNPJ, valor e vencimento (se houver) desta NFS-e e responda apenas com o JSON pedido.',
      { buffer, mimeType },
      300,
      { feature: 'nfse_extraction', userId }
    );
    if (!text) return null;
    const parsed = extractJson<NfseExtracted>(text);
    if (!parsed) {
      logger.warn({ text }, '[nfse-extraction] resposta da Claude não pôde ser interpretada como JSON');
      return null;
    }
    return parsed;
  } catch (err) {
    logger.warn({ err }, '[nfse-extraction] falha ao extrair campos da NFS-e');
    return null;
  }
}
