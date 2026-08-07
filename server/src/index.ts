import { createServer } from 'node:http';
import { app } from './app.js';
import { seedIfEmpty } from './db/seed.js';
import { attachWebSocketServer } from './ws.js';
import { startHealthMonitor } from './lib/healthMonitor.js';
import { startAceiteReminderJob } from './lib/aceiteReminder.js';
import { startAutoEmitJob } from './lib/autoEmitJob.js';
import { startBackupJob } from './lib/backup.js';
import { startSuspiciousActivityJob } from './lib/suspiciousActivityMonitor.js';
import { logger } from './lib/logger.js';

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;

async function main() {
  await seedIfEmpty();
  const server = createServer(app);
  attachWebSocketServer(server);
  startHealthMonitor();
  startAceiteReminderJob();
  startAutoEmitJob();
  startBackupJob();
  startSuspiciousActivityJob();
  server.listen(PORT, () => {
    logger.info(`Lastro API listening on http://localhost:${PORT} (WebSocket at /ws/market)`);
  });
}

main();
