import { logger } from './logger.js';

// Real-when-configured adapter for a commercial judicial-records/litigation-history
// provider (Escavador, Jusbrasil API, etc.) — checks a CNPJ for open execuções,
// falência/recuperação judicial and protestos before it becomes a real credit-risk signal
// in the Compliance AI Engine (lib/complianceEngine.ts). Requires a real commercial
// contract this environment can't provide — no free official public API exists for this
// in Brazil, unlike OFAC's sanctions list — so this is a no-op until
// JUDICIAL_RECORDS_API_URL/KEY are set, same honest pattern as lib/creditBureau.ts.
const apiUrl = process.env.JUDICIAL_RECORDS_API_URL;
const apiKey = process.env.JUDICIAL_RECORDS_API_KEY;
export const judicialRecordsEnabled = !!(apiUrl && apiKey);

if (judicialRecordsEnabled) logger.info('[judicial-records] provedor de histórico judicial configurado — verificação real habilitada');
else logger.info('[judicial-records] JUDICIAL_RECORDS_API_URL/KEY não configurado — verificação de histórico judicial desativada');

export interface JudicialRecordsResult {
  processCount: number;
  hasExecutions: boolean;
  hasBankruptcyOrRecovery: boolean;
  hasProtests: boolean;
  fonte: string;
}

export async function screenJudicialRecords(cnpj: string): Promise<JudicialRecordsResult | null> {
  if (!judicialRecordsEnabled) return null;
  const digits = cnpj.replace(/\D/g, '');
  if (!digits) return null;
  const res = await fetch(`${apiUrl}/cnpj/${digits}/processos`, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (res.status === 404) {
    return { processCount: 0, hasExecutions: false, hasBankruptcyOrRecovery: false, hasProtests: false, fonte: 'provedor_judicial' };
  }
  if (!res.ok) throw new Error(`judicial_records_fetch_failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as {
    processCount?: number;
    hasExecutions?: boolean;
    hasBankruptcyOrRecovery?: boolean;
    hasProtests?: boolean;
  };
  return {
    processCount: data.processCount ?? 0,
    hasExecutions: !!data.hasExecutions,
    hasBankruptcyOrRecovery: !!data.hasBankruptcyOrRecovery,
    hasProtests: !!data.hasProtests,
    fonte: 'provedor_judicial',
  };
}
