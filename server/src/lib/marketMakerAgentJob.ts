import { listActiveInvestidores, getSettings } from '../db/users.js';
import { runAgent } from './agentRuntime.js';
import { marketMakerAgent } from './agents/marketMaker.js';
import { hasRecentAgentRun } from '../db/agents.js';
import { addNotification } from '../db/misc.js';
import { claudeEnabled } from './claude.js';
import { COLORS } from '../data/seed.js';
import { logger } from './logger.js';
import { isFeatureEnabled } from './featureFlags.js';

// Turns the Market Maker agent from "an investor has to remember to click it" into the
// actual liquidity source the feature promises — same pattern as cobrancaAgentJob.ts and
// pldAgentJob.ts, one periodic scan feeding the agent instead of only reacting to a manual
// self-service run. Every candidate here already opted in (settings.marketMakerEnabled);
// dar_lance_liquidez stays sensitive/self-approvable — nothing here commits real capital
// without going through the exact same approval step a manual self-service run would.
const RESCAN_COOLDOWN_HOURS = 6;
const MAX_INVESTORS_PER_SCAN = 15;

export async function runMarketMakerAgentScan(): Promise<{ scanned: number; newPendingActions: number }> {
  // Same real-when-configured discipline as every agent: without a key there's no honest
  // investigation to run automatically, so the job is a documented no-op rather than a
  // fake scan.
  if (!claudeEnabled) return { scanned: 0, newPendingActions: 0 };
  // Global kill switch (see lib/featureFlags.ts) — distinct from each investor's own
  // settings.marketMakerEnabled opt-in: this one lets an admin pause automated liquidity
  // for everyone at once (e.g. during a market disruption) without touching anyone's
  // individual preference, which stays intact and simply resumes once re-enabled.
  if (!isFeatureEnabled('market_maker_agent')) return { scanned: 0, newPendingActions: 0 };

  let scanned = 0;
  let newPendingActions = 0;

  for (const investor of listActiveInvestidores()) {
    if (scanned >= MAX_INVESTORS_PER_SCAN) break;
    if (!getSettings(investor).marketMakerEnabled) continue;
    // Dedup guard: don't re-spend tokens re-scanning an investor's book that was already
    // looked at recently, regardless of what the agent concluded last time.
    if (hasRecentAgentRun('market_maker', 'user', String(investor.id), RESCAN_COOLDOWN_HOURS)) continue;

    scanned++;
    try {
      const outcome = await runAgent(marketMakerAgent, {
        input: `Você está atuando em nome do investidor userId=${investor.id} (${investor.company_name}), que optou por fornecer liquidez ao mercado secundário. Avalie os anúncios ativos de outros investidores sem nenhum lance e, dentro do score mínimo e do limite de exposição configurados, proponha lances de liquidez nos melhores candidatos.`,
        userId: investor.id,
        subjectType: 'user',
        subjectId: String(investor.id),
      });
      newPendingActions += outcome.pendingActions.length;
      // Self-approvable pending actions notify the investor themselves, not an admin —
      // it's their own capital and their own approval step, same as autoBid's runs.
      if (outcome.pendingActions.length > 0) {
        addNotification(
          investor.id,
          `Agente Market Maker (IA) propôs ${outcome.pendingActions.length} lance${outcome.pendingActions.length === 1 ? '' : 's'} de liquidez — revise em Agentes IA.`,
          COLORS.BLUE
        );
      }
    } catch (err) {
      logger.warn({ err, investorId: investor.id }, '[market-maker-agent-job] falha ao varrer investidor');
    }
  }

  if (scanned > 0) logger.info({ scanned, newPendingActions }, '[market-maker-agent-job] varredura concluída');
  return { scanned, newPendingActions };
}

// Started only from src/index.ts (the real server process) — importing app.ts in tests
// never spins up a background timer, same pattern as every other job in this codebase.
export function startMarketMakerAgentJob(intervalMs = 6 * 60 * 60 * 1000): NodeJS.Timeout {
  void runMarketMakerAgentScan();
  return setInterval(() => void runMarketMakerAgentScan(), intervalMs);
}
