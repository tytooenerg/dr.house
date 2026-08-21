import { listUsersWithWhitelabelPlus } from '../db/users.js';
import { chargeOncePerPeriod, fmtAddOnPrice } from './addOnBilling.js';
import { logger } from './logger.js';

// Feature 4 — White-label Plus: a flat monthly recurring fee (lib/addOnBilling.ts,
// kind='whitelabel_plus') for the extended white-label surface — see erp.ts's
// /whitelabel/plus toggle and the extra branding touchpoints beyond the WhatsApp
// reminder (aceite view brandLabel, lib/aceiteCore.ts). Independent of plan tier: an
// Empresarial cedente can be white-label-plus-subscribed or not.

export async function runWhitelabelPlusBilling(period?: string): Promise<{ period: string; charged: number; skipped: number }> {
  const users = listUsersWithWhitelabelPlus();
  let charged = 0;
  let skipped = 0;
  for (const user of users) {
    const result = await chargeOncePerPeriod(user.id, 'whitelabel_plus', 1, `Assinatura White-label Plus (${fmtAddOnPrice('whitelabel_plus')}/mês)`, period);
    if (result) {
      charged++;
      logger.info({ userId: user.id }, '[whitelabel-plus] cobrança mensal registrada');
    } else {
      skipped++;
    }
  }
  return { period: period ?? new Date().toISOString().slice(0, 7), charged, skipped };
}

function previousMonthKey(): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
}

// Only started from src/index.ts, same pattern as every other background job here.
export function startWhitelabelPlusBillingJob(intervalMs = 24 * 60 * 60 * 1000): NodeJS.Timeout {
  const run = () => {
    runWhitelabelPlusBilling(previousMonthKey()).catch((err) => logger.error({ err }, '[whitelabel-plus] falha ao rodar cobrança mensal'));
  };
  run();
  return setInterval(run, intervalMs);
}
