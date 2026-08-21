import { getIntSetting, setPlatformSetting } from '../db/platformSettings.js';
import { sumLivePlatformUsageByUser } from '../db/apiKeys.js';
import { getUserById } from '../db/users.js';
import { chargeOncePerPeriod, fmtAddOnPrice } from './addOnBilling.js';
import { logger } from './logger.js';

// Usage-based billing on top of the existing plan gating: a live, full-platform partner
// API key only requires the Empresarial plan (routes/dev.ts) — this adds a real charge
// for usage beyond a monthly included quota, the same metered-overage model most paid
// APIs use (Stripe's own usage-based billing included). Test-mode usage stays free (see
// the free sandbox dev tier), and this only ever looks at 'platform'-product keys — the
// standalone Score API / PLD screening API products (lib/addOnBilling.ts) are billed
// per-call instead, not against this quota.

const INCLUDED_CALLS_SETTING = 'api_included_calls_per_month';
const DEFAULT_INCLUDED_CALLS = 10_000;

export function getIncludedCallsPerMonth(): number {
  return getIntSetting(INCLUDED_CALLS_SETTING, DEFAULT_INCLUDED_CALLS);
}

export function setIncludedCallsPerMonth(value: number, adminId?: number) {
  setPlatformSetting(INCLUDED_CALLS_SETTING, String(value), adminId);
}

export interface OverageBillingResult {
  period: string;
  charged: number;
  skipped: number;
}

// Idempotent per (user, month) via addon_charges' UNIQUE constraint (enforced in
// chargeOncePerPeriod) — safe to call more than once for the same period, whether from
// the monthly cron or an admin's manual "cobrar agora" trigger.
export async function runApiOverageBilling(period?: string): Promise<OverageBillingResult> {
  const included = getIncludedCallsPerMonth();
  const usageRows = sumLivePlatformUsageByUser(period ?? new Date().toISOString().slice(0, 7));
  let charged = 0;
  let skipped = 0;
  for (const row of usageRows) {
    const overage = row.calls - included;
    if (overage <= 0) {
      skipped++;
      continue;
    }
    const user = getUserById(row.userId);
    if (!user) {
      skipped++;
      continue;
    }
    const result = await chargeOncePerPeriod(
      row.userId,
      'api_overage',
      overage,
      `Excedente de uso da API — ${overage} chamada(s) além da franquia de ${included}/mês (${fmtAddOnPrice('api_overage')}/chamada)`,
      period
    );
    if (result) {
      charged++;
      logger.info({ userId: row.userId, overage, amount: result.amount }, '[api-overage] cobrança de excedente registrada');
    } else {
      skipped++;
    }
  }
  return { period: period ?? new Date().toISOString().slice(0, 7), charged, skipped };
}

function previousMonthKey(): string {
  const d = new Date();
  d.setUTCDate(1); // avoid month-length edge cases (e.g. Mar 31 - 1 month)
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
}

// Only started from src/index.ts (never during tests/importing app.ts), same pattern as
// every other background job in this codebase. Runs daily but always targets the
// previous complete calendar month — safe to run more than once a day since billing is
// idempotent per (user, month).
export function startApiOverageBillingJob(intervalMs = 24 * 60 * 60 * 1000): NodeJS.Timeout {
  const run = () => {
    runApiOverageBilling(previousMonthKey()).catch((err) => logger.error({ err }, '[api-overage] falha ao rodar cobrança de excedente'));
  };
  run();
  return setInterval(run, intervalMs);
}
