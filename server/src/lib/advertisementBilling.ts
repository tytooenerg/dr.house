import { listActiveApprovedAdvertiserIds } from '../db/advertisements.js';
import { chargeOncePerPeriod, fmtAddOnPrice } from './addOnBilling.js';
import { logger } from './logger.js';

// Carrossel de publicidade: a flat monthly recurring fee (lib/addOnBilling.ts,
// kind='publicidade_carrossel') for a slot in the landing page's ad carousel — same shape
// as lib/whitelabelBilling.ts's White-label Plus billing. Only an advertisement that is
// both 'aprovado' (admin moderation, routes/admin.ts) and 'ativo' (the advertiser's own
// on/off switch) is billed; a pending, rejected, or paused one never is.

export async function runAdvertisementBilling(period?: string): Promise<{ period: string; charged: number; skipped: number }> {
  const advertiserIds = listActiveApprovedAdvertiserIds();
  let charged = 0;
  let skipped = 0;
  for (const advertiserId of advertiserIds) {
    const result = await chargeOncePerPeriod(advertiserId, 'publicidade_carrossel', 1, `Assinatura carrossel de publicidade (${fmtAddOnPrice('publicidade_carrossel')}/mês)`, period);
    if (result) {
      charged++;
      logger.info({ advertiserId }, '[advertisement-billing] cobrança mensal registrada');
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
export function startAdvertisementBillingJob(intervalMs = 24 * 60 * 60 * 1000): NodeJS.Timeout {
  const run = () => {
    runAdvertisementBilling(previousMonthKey()).catch((err) => logger.error({ err }, '[advertisement-billing] falha ao rodar cobrança mensal'));
  };
  run();
  return setInterval(run, intervalMs);
}
