import { listSuspiciousActivityReports } from '../db/suspiciousActivity.js';
import { listRecentComplianceAlerts } from '../db/complianceAlerts.js';
import { runFraudAnomalyScan } from './fraudAnomalyDetection.js';
import { runAgent } from './agentRuntime.js';
import { pldAgent } from './agents/pld.js';
import { hasRecentAgentRun } from '../db/agents.js';
import { notifyAdmins } from '../db/misc.js';
import { getUserById } from '../db/users.js';
import { claudeEnabled } from './claude.js';
import { COLORS } from '../data/seed.js';
import { logger } from './logger.js';

// The "vigia sozinho" version of the PLD agent — same pattern as cobrancaAgentJob.ts, one
// job feeding two real signal sources instead of only reacting to a button click:
//   - the rule-based suspicious-activity monitor (fracionamento/entrada_saída_rápida —
//     lib/suspiciousActivityMonitor.ts) already flags accounts automatically;
//   - fraud-shaped compliance alerts (valor anômalo, reuso de NF-e — lib/emitirCore.ts)
//     are the closest thing this codebase has to a dedicated fraud detector today.
// Both just get counted/logged today; this lets the PLD agent actually investigate each
// one (real sanctions/judicial screening) instead of leaving a raw signal for an admin to
// interpret cold. sinalizar_pld is still sensitive/gated — this only ever proposes.
const RESCAN_COOLDOWN_HOURS = 24;
const MAX_CASES_PER_SCAN = 10;

export async function runPldAgentScan(): Promise<{ scanned: number; newPendingActions: number }> {
  if (!claudeEnabled) return { scanned: 0, newPendingActions: 0 };

  const candidates = new Map<number, string>();
  for (const r of listSuspiciousActivityReports('aberto')) {
    candidates.set(r.user_id, `relatório de atividade suspeita automático (${r.tipo}, ${r.severidade})`);
  }
  for (const a of listRecentComplianceAlerts(30)) {
    if (a.user_id && (a.type === 'valor_anomalo' || a.type === 'nfe_duplicidade') && !candidates.has(a.user_id)) {
      candidates.set(a.user_id, `alerta de compliance (${a.type}): ${a.message}`);
    }
  }
  for (const f of runFraudAnomalyScan()) {
    if (f.cedenteId && !candidates.has(f.cedenteId)) {
      candidates.set(f.cedenteId, `anomalia de rede (${f.tipo}): ${f.descricao}`);
    }
  }

  let scanned = 0;
  let newPendingActions = 0;
  for (const [userId, reason] of candidates) {
    if (scanned >= MAX_CASES_PER_SCAN) break;
    if (hasRecentAgentRun('pld', 'user', String(userId), RESCAN_COOLDOWN_HOURS)) continue;
    const user = getUserById(userId);
    if (!user) continue;

    scanned++;
    try {
      const outcome = await runAgent(pldAgent, {
        input: `Investigue esta conta (userId=${userId}, empresa "${user.company_name}") — motivo do sinal automático: ${reason}. Verifique sanções/PEP e histórico judicial antes de decidir se há evidência real o suficiente para sinalizar.`,
        subjectType: 'user',
        subjectId: String(userId),
      });
      newPendingActions += outcome.pendingActions.length;
    } catch (err) {
      logger.warn({ err, userId }, '[pld-agent-job] falha ao investigar conta');
    }
  }

  if (newPendingActions > 0) {
    notifyAdmins(`Agente de PLD (IA) propôs ${newPendingActions} sinalização(ões) de PLD — revise em Agentes IA.`, COLORS.RED);
  }
  if (scanned > 0) logger.info({ scanned, newPendingActions }, '[pld-agent-job] varredura concluída');
  return { scanned, newPendingActions };
}

export function startPldAgentJob(intervalMs = 6 * 60 * 60 * 1000): NodeJS.Timeout {
  void runPldAgentScan();
  return setInterval(() => void runPldAgentScan(), intervalMs);
}
