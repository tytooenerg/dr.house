import { listPendingKyb } from '../db/users.js';
import { listAllOpenDisputes } from '../db/disputes.js';
import { listPendingComplianceReview } from '../db/complianceEngine.js';
import { listSuspiciousActivityReports } from '../db/suspiciousActivity.js';
import { listFundClaims } from '../db/guaranteeFund.js';
import { listFlags } from '../db/reconciliation.js';
import { listPendingTedDeposits } from '../db/ted.js';
import { notifyAdmins } from '../db/misc.js';
import { db } from '../db/index.js';
import { sendEmail } from './mailer.js';
import { COLORS } from '../data/seed.js';
import { logger } from './logger.js';

// The admin back-office has 9 tabs (KYB, disputas, compliance, jurídico, IA, agentes,
// reconciliação, flags, auditoria) and no single place that says which of them actually
// need a human today — an admin has to open each one to find out. This doesn't decide or
// act on anything (unlike the agents, which at least investigate); it's purely a
// prioritized "here's where your time should go" summary, delivered once a day instead of
// requiring nine manual checks.
export interface DailyBriefingItem {
  label: string;
  count: number;
  severity: 'critico' | 'atencao' | 'info';
}

export interface DailyBriefing {
  items: DailyBriefingItem[];
  totalPendente: number;
  geradoEm: string;
}

export function buildDailyBriefing(): DailyBriefing {
  const kyb = listPendingKyb().length;
  const disputas = listAllOpenDisputes().length;
  const compliance = listPendingComplianceReview().length;
  const sarCritico = listSuspiciousActivityReports('aberto').filter((s) => s.severidade === 'critico').length;
  const sarAtencao = listSuspiciousActivityReports('aberto').length - sarCritico;
  const fundClaims = listFundClaims('aberto').length;
  const reconciliacao = listFlags('aberta').length;
  const ted = listPendingTedDeposits().length;

  const items: DailyBriefingItem[] = (
    [
      { label: 'Alertas de PLD críticos', count: sarCritico, severity: 'critico' },
      { label: 'Acionamentos do fundo de garantia', count: fundClaims, severity: 'critico' },
      { label: 'Duplicatas em revisão de compliance', count: compliance, severity: 'atencao' },
      { label: 'Disputas em aberto', count: disputas, severity: 'atencao' },
      { label: 'Alertas de PLD (atenção)', count: sarAtencao, severity: 'atencao' },
      { label: 'Credenciamentos (KYB) pendentes', count: kyb, severity: 'info' },
      { label: 'Divergências de reconciliação em aberto', count: reconciliacao, severity: 'info' },
      { label: 'Depósitos TED pendentes de confirmação', count: ted, severity: 'info' },
    ] satisfies DailyBriefingItem[]
  ).filter((i) => i.count > 0);

  return { items, totalPendente: items.reduce((sum, i) => sum + i.count, 0), geradoEm: new Date().toISOString() };
}

function formatBriefingText(briefing: DailyBriefing): string {
  if (briefing.items.length === 0) return 'Nenhuma fila pendente hoje — back-office limpo.';
  const lines = briefing.items.map((i) => `- ${i.label}: ${i.count}`);
  return `Resumo diário do back-office (${briefing.totalPendente} item(ns) pendente(s) no total):\n${lines.join('\n')}`;
}

export async function runDailyBriefing(): Promise<DailyBriefing> {
  const briefing = buildDailyBriefing();
  if (briefing.items.length === 0) {
    logger.info('[daily-briefing] nada pendente — nenhuma notificação enviada');
    return briefing;
  }

  const critico = briefing.items.some((i) => i.severity === 'critico');
  const headline = briefing.items
    .slice(0, 3)
    .map((i) => `${i.count} ${i.label.toLowerCase()}`)
    .join(', ');
  notifyAdmins(`Resumo diário: ${headline}${briefing.items.length > 3 ? '…' : ''} — veja o back-office.`, critico ? COLORS.RED : COLORS.AMBER);

  const text = formatBriefingText(briefing);
  const admins = db.prepare("SELECT email, settings FROM users WHERE role = 'admin' AND deleted_at IS NULL").all() as { email: string; settings: string }[];
  for (const a of admins) {
    // Same opt-in email-preferences gate every other automated email in this codebase
    // respects (db/misc.ts's addNotification) — a daily digest is exactly the kind of
    // email an admin should be able to turn off without losing the in-app bell version.
    try {
      const settings = JSON.parse(a.settings || '{}');
      if (settings.notifPrefs && settings.notifPrefs.digest === false) continue;
    } catch {
      // malformed settings JSON — default to sending, same as every other notification path
    }
    await sendEmail(a.email, `Lastro — resumo diário do back-office (${briefing.totalPendente} pendente(s))`, text);
  }

  logger.info({ totalPendente: briefing.totalPendente }, '[daily-briefing] enviado');
  return briefing;
}

export function startDailyBriefingJob(intervalMs = 24 * 60 * 60 * 1000): NodeJS.Timeout {
  void runDailyBriefing();
  return setInterval(() => void runDailyBriefing(), intervalMs);
}

// Exported for the admin back-office to show "what would today's briefing say" on demand
// (GET /admin/daily-briefing) without waiting for the next scheduled run or sending
// anything — notifyAdmins/sendEmail only happen from runDailyBriefing/the cron job.
export function peekDailyBriefing(): DailyBriefing {
  return buildDailyBriefing();
}
