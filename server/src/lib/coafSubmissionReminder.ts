import { listSuspiciousActivityReports } from '../db/suspiciousActivity.js';
import { notifyAdmins } from '../db/misc.js';
import { COLORS } from '../data/seed.js';
import { logger } from './logger.js';

// Honest scope note (see the comment at the top of lib/regulatoryReports.ts): SISCOAF has
// no public API a real institution can integrate against outside its own government-issued
// credentials — unlike registradoras/bureau/PSP integrations elsewhere in this codebase,
// there is no real vendor contract here to build a "real-when-configured" submission
// channel against, so faking one would mean inventing a fictional API. What IS honestly
// automatable: making sure an open SAR that still needs manual filing doesn't just sit
// there because no one remembered — the actual gap this closes.
const STALE_AFTER_DAYS = 2;

export interface CoafReminderResult { stale: number }

export function runCoafSubmissionReminder(): CoafReminderResult {
  const open = listSuspiciousActivityReports('aberto');
  const cutoff = Date.now() - STALE_AFTER_DAYS * 86400000;
  const stale = open.filter((r) => new Date(r.created_at.replace(' ', 'T') + 'Z').getTime() < cutoff);

  if (stale.length > 0) {
    notifyAdmins(
      `${stale.length} comunicação(ões) de operação suspeita aguardam envio ao SISCOAF há mais de ${STALE_AFTER_DAYS} dias — revise em Back-office → PLD.`,
      COLORS.RED
    );
    logger.info({ stale: stale.length }, '[coaf-reminder] alertou sobre SARs pendentes de envio');
  }
  return { stale: stale.length };
}

export function startCoafSubmissionReminderJob(intervalMs = 24 * 60 * 60 * 1000): NodeJS.Timeout {
  runCoafSubmissionReminder();
  return setInterval(() => runCoafSubmissionReminder(), intervalMs);
}
