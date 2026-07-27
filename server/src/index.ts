import { createServer } from 'node:http';
import { app } from './app.js';
import { seedIfEmpty } from './db/seed.js';
import { attachWebSocketServer } from './ws.js';
import { startHealthMonitor } from './lib/healthMonitor.js';
import { logger } from './lib/logger.js';

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;

async function main() {
  await seedIfEmpty();
  const server = createServer(app);
  attachWebSocketServer(server);
  startHealthMonitor();
  server.listen(PORT, () => {
    logger.info(`Lastro API listening on http://localhost:${PORT} (WebSocket at /ws/market)`);
  });
}

main();
