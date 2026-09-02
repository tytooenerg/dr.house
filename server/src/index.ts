import { createServer } from 'node:http';
// Started (or honestly skipped, unconfigured) before anything else below — see
// lib/tracing.ts. Auto-instrumentation of http/express can only patch modules not yet
// loaded, and ./app.js below is a static ESM import evaluated before any code in this
// file runs, so under this ESM/tsx setup auto-instrumentation coverage is best-effort;
// the manual spans added at real I/O boundaries (registradora calls, agent runs) are the
// guaranteed-real signal regardless, since they call getTracer() at request time, well
// after the SDK has started.
import { startTracing } from './lib/tracing.js';
import { app } from './app.js';
import { seedIfEmpty } from './db/seed.js';
import { backfillDuplicataSetor } from './db/duplicatas.js';
import { attachWebSocketServer } from './ws.js';
import { startHealthMonitor } from './lib/healthMonitor.js';
import { startAceiteReminderJob } from './lib/aceiteReminder.js';
import { startAutoEmitJob } from './lib/autoEmitJob.js';
import { startBackupJob } from './lib/backup.js';
import { startSuspiciousActivityJob } from './lib/suspiciousActivityMonitor.js';
import { startApiOverageBillingJob } from './lib/apiOverageBilling.js';
import { startWhitelabelPlusBillingJob } from './lib/whitelabelBilling.js';
import { startInstitutionalReportingBillingJob } from './lib/institutionalReporting.js';
import { startAdvertisementBillingJob } from './lib/advertisementBilling.js';
import { startCobrancaAgentJob } from './lib/cobrancaAgentJob.js';
import { startPldAgentJob } from './lib/pldAgentJob.js';
import { startMarketMakerAgentJob } from './lib/marketMakerAgentJob.js';
import { startReconciliationAgentJob } from './lib/reconciliationAgentJob.js';
import { startCoafSubmissionReminderJob } from './lib/coafSubmissionReminder.js';
import { startDailyBriefingJob } from './lib/dailyBriefing.js';
import { startMonthlyRegulatoryReportsJob } from './lib/monthlyRegulatoryReportsJob.js';
import { logger } from './lib/logger.js';

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;

async function main() {
  await startTracing();
  await seedIfEmpty();
  const backfilled = backfillDuplicataSetor();
  if (backfilled > 0) logger.info(`[duplicatas] classificou setor de ${backfilled} duplicata(s) existente(s) sem essa coluna preenchida`);
  const server = createServer(app);
  attachWebSocketServer(server);
  startHealthMonitor();
  startAceiteReminderJob();
  startAutoEmitJob();
  startBackupJob();
  startSuspiciousActivityJob();
  startApiOverageBillingJob();
  startWhitelabelPlusBillingJob();
  startInstitutionalReportingBillingJob();
  startAdvertisementBillingJob();
  startCobrancaAgentJob();
  startPldAgentJob();
  startMarketMakerAgentJob();
  startReconciliationAgentJob();
  startCoafSubmissionReminderJob();
  startDailyBriefingJob();
  startMonthlyRegulatoryReportsJob();
  server.listen(PORT, () => {
    logger.info(`Lastro API listening on http://localhost:${PORT} (WebSocket at /ws/market)`);
  });
}

main();
