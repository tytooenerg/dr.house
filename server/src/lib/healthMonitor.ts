import { db } from '../db/index.js';
import { recordHealthCheck } from '../db/systemHealth.js';
import { logger } from './logger.js';

// A genuine periodic self-check (not a fake "always green" badge) — pings the database
// on an interval and logs the result, so the public /status page has real history instead
// of a hand-set flag. Only started from src/index.ts (the actual server process), never
// from app.ts, so importing the app in tests never spins up a background timer.
export function startHealthMonitor(intervalMs = 60_000): NodeJS.Timeout {
  const check = () => {
    const start = Date.now();
    try {
      db.prepare('SELECT 1').get();
      recordHealthCheck('ok', Date.now() - start);
    } catch (err) {
      logger.error({ err }, '[health] self-check failed');
      recordHealthCheck('degraded', Date.now() - start);
    }
  };
  check();
  return setInterval(check, intervalMs);
}
