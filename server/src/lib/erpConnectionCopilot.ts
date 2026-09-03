import { askClaude, claudeEnabled, extractJson } from './claude.js';
import { logger } from './logger.js';

// Copilot for a cedente stuck on a failed ERP connection (routes/erp.ts's /sap/connect,
// /totvs/connect, /omie/connect) — the raw error from lib/erpConnectors/*.ts (e.g.
// "sap_login_failed: 401 {...}", "totvs_auth_no_token", a raw Node fetch error) is
// technically accurate but not actionable for someone outside engineering. This translates
// it into a likely cause + next step, on-demand, never invented beyond what the error
// string + connector actually say.
const SYSTEM = `Você ajuda um cliente da Lastro (plataforma de antecipação de recebíveis) a entender por que a conexão com o ERP dele (SAP Business One, TOTVS ou Omie) falhou. Você recebe o nome do conector e a mensagem de erro técnica bruta retornada pela integração real. Com base APENAS nessa mensagem (nunca invente uma causa que ela não sugere), explique a causa mais provável em linguagem simples e o que a pessoa deve conferir a seguir.
Responda APENAS com um JSON válido no formato exato:
{"causaProvavel": "explicação em português, 1-2 frases, sem jargão técnico desnecessário", "proximoPasso": "uma ação concreta e específica pra essa pessoa tentar, em português"}`;

export interface ErpDiagnosis {
  causaProvavel: string;
  proximoPasso: string;
}

export async function diagnoseErpConnectionError(connector: 'sap' | 'totvs' | 'omie', rawError: string, userId?: number): Promise<ErpDiagnosis | null> {
  if (!claudeEnabled) return null;
  try {
    const context = `Conector: ${connector}\nErro técnico retornado pela integração: ${rawError}`;
    const text = await askClaude(SYSTEM, context, 300, { feature: 'erp_connection_copilot', userId });
    if (!text) return null;
    const parsed = extractJson<ErpDiagnosis>(text);
    if (!parsed || !parsed.causaProvavel || !parsed.proximoPasso) {
      logger.warn({ text }, '[erp-connection-copilot] resposta não pôde ser interpretada');
      return null;
    }
    return parsed;
  } catch (err) {
    logger.warn({ err }, '[erp-connection-copilot] falha ao gerar diagnóstico');
    return null;
  }
}
