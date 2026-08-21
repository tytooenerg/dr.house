import { listOverdueDuplicatas } from '../db/duplicatas.js';
import { checkCollectionEligibility } from './legalCollection.js';
import { runAgent } from './agentRuntime.js';
import { cobrancaAgent } from './agents/cobranca.js';
import { hasRecentAgentRun } from '../db/agents.js';
import { notifyAdmins } from '../db/misc.js';
import { claudeEnabled } from './claude.js';
import { COLORS } from '../data/seed.js';
import { logger } from './logger.js';

// Turns the Cobrança agent from "an admin has to remember to click it" into the actual
// régua: periodically scans overdue duplicatas and lets the agent decide, per case,
// whether to propose escalating to legal collection — same agent, same tool set, same
// human-approval gate (escalar_cobranca is sensitive; nothing here ever sends a real
// notification/protesto/execução without an admin approving the resulting pending action).
const RESCAN_COOLDOWN_HOURS = 24;
const MAX_CASES_PER_SCAN = 10;

export async function runCobrancaAgentScan(): Promise<{ scanned: number; newPendingActions: number }> {
  // Same real-when-configured discipline as every agent: without a key there's no honest
  // investigation to run automatically, so the job is a documented no-op rather than a
  // fake scan.
  if (!claudeEnabled) return { scanned: 0, newPendingActions: 0 };

  const overdue = listOverdueDuplicatas();
  let scanned = 0;
  let newPendingActions = 0;

  for (const d of overdue) {
    if (scanned >= MAX_CASES_PER_SCAN) break;
    // Dedup guard: don't re-spend tokens investigating a case that was already looked at
    // recently, regardless of what the agent concluded last time.
    if (hasRecentAgentRun('cobranca', 'duplicata', d.id, RESCAN_COOLDOWN_HOURS)) continue;
    if (!checkCollectionEligibility(d).eligible) continue;

    scanned++;
    try {
      const outcome = await runAgent(cobrancaAgent, {
        input: `Verifique a duplicata ${d.id} (sacado ${d.sacado_nome}) e, se for elegível, escale para cobrança jurídica com o tipo de documento proporcional ao tempo de atraso.`,
        subjectType: 'duplicata',
        subjectId: d.id,
      });
      newPendingActions += outcome.pendingActions.length;
    } catch (err) {
      logger.warn({ err, duplicataId: d.id }, '[cobranca-agent-job] falha ao investigar duplicata vencida');
    }
  }

  if (newPendingActions > 0) {
    notifyAdmins(
      `Agente de Cobrança (IA) propôs ${newPendingActions} escalação${newPendingActions === 1 ? '' : 'ões'} jurídica${newPendingActions === 1 ? '' : 's'} — revise em Agentes IA.`,
      COLORS.AMBER
    );
  }
  if (scanned > 0) logger.info({ scanned, newPendingActions }, '[cobranca-agent-job] varredura concluída');
  return { scanned, newPendingActions };
}

// Started only from src/index.ts (the real server process) — importing app.ts in tests
// never spins up a background timer, same pattern as every other job in this codebase.
export function startCobrancaAgentJob(intervalMs = 6 * 60 * 60 * 1000): NodeJS.Timeout {
  void runCobrancaAgentScan();
  return setInterval(() => void runCobrancaAgentScan(), intervalMs);
}
