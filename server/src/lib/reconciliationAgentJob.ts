import { runReconciliation, type ReconciliationRunResult } from './reconciliation.js';
import { recordAuditEvent } from '../db/audit.js';
import { notifyAdmins } from '../db/misc.js';
import { COLORS } from '../data/seed.js';
import { logger } from './logger.js';
import { isFeatureEnabled } from './featureFlags.js';

// Honest gap called out in README's "Reconciliation Agent" section: until now the check
// only ran when an admin remembered to click "Rodar reconciliação agora" — a real
// unmatched-payment gap could sit undetected for days. This closes that gap the same way
// Cobrança/PLD/Market Maker did (a periodic job in src/index.ts), except the underlying
// check (lib/reconciliation.ts's runReconciliation) is deterministic SQL matching, not an
// LLM call — so unlike those jobs this one does NOT no-op without ANTHROPIC_API_KEY. The
// admin-only manual trigger (POST /api/reconciliation/run) already calls the exact same
// function directly rather than through the agent's tool-use loop; this job just does the
// same thing on a schedule instead of waiting for a click.
const LOOKBACK_DAYS = 7;

export function runReconciliationScan(): ReconciliationRunResult {
  // Same kill-switch shape as 'market_maker_agent' — lets an admin pause the automated
  // scan (e.g. during a known payment-rail incident generating expected noise) without
  // touching the manual "Rodar reconciliação agora" button, which stays available.
  if (!isFeatureEnabled('reconciliation_agent')) return { checked: 0, matched: 0, newlyFlagged: 0 };

  const result = runReconciliation(LOOKBACK_DAYS);
  recordAuditEvent(null, 'Agente de Reconciliação (automático)', 'reconciliation.run', { ...result, automatico: true });
  if (result.newlyFlagged > 0) {
    notifyAdmins(
      `Reconciliação automática encontrou ${result.newlyFlagged} pagamento(s) confirmado(s) sem lançamento correspondente no extrato — revise em Back-office → Reconciliação.`,
      COLORS.RED
    );
  }
  if (result.checked > 0) logger.info({ ...result }, '[reconciliation-agent-job] varredura concluída');
  return result;
}

// Started only from src/index.ts (the real server process) — importing app.ts in tests
// never spins up a background timer, same pattern as every other job in this codebase.
export function startReconciliationAgentJob(intervalMs = 6 * 60 * 60 * 1000): NodeJS.Timeout {
  runReconciliationScan();
  return setInterval(() => runReconciliationScan(), intervalMs);
}
