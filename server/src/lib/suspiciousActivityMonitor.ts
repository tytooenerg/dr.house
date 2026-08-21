import { db } from '../db/index.js';
import { createSuspiciousActivityReport, hasRecentOpenReport } from '../db/suspiciousActivity.js';
import { getPlatformSetting, setPlatformSetting } from '../db/platformSettings.js';
import { fmtBRL } from './format.js';
import { logger } from './logger.js';

// Automated suspicious-activity monitoring, beyond the emission-time checks already in
// lib/fraudDetection.ts (value anomaly, NF-e reuse). Deterministic rules only — same
// "deterministic core" principle as the Compliance AI Engine — scanning real ledger
// activity for two classic, well-defined AML patterns. See db/suspiciousActivity.ts and
// the migration for what happens once something is flagged (an admin reviews it; real
// COAF submission needs a licensed institution's credentials this repo can't have).

const DEFAULT_STRUCTURING_THRESHOLD = 50_000;
const SETTING_KEY = 'sar_structuring_threshold';

export function getStructuringThreshold(): number {
  const raw = getPlatformSetting(SETTING_KEY);
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : DEFAULT_STRUCTURING_THRESHOLD;
}

export function setStructuringThreshold(value: number, adminId?: number) {
  setPlatformSetting(SETTING_KEY, String(value), adminId);
}

interface LedgerRow {
  id: number;
  user_id: number;
  valor: number;
  created_at: string;
}

function groupByUser(rows: LedgerRow[]): Map<number, LedgerRow[]> {
  const byUser = new Map<number, LedgerRow[]>();
  for (const r of rows) {
    if (!byUser.has(r.user_id)) byUser.set(r.user_id, []);
    byUser.get(r.user_id)!.push(r);
  }
  return byUser;
}

// Rule 1: fracionamento (structuring/"smurfing") — 3+ deposits from the same account
// within 24h, each individually under the reporting threshold, summing to more than it.
// The classic pattern of splitting a large deposit into smaller ones to dodge
// per-transaction review.
export function detectFracionamento(): number {
  const threshold = getStructuringThreshold();
  const rows = db
    .prepare(`SELECT id, user_id, valor, created_at FROM ledger WHERE valor > 0 AND valor < ? AND created_at >= datetime('now', '-24 hours')`)
    .all(threshold) as LedgerRow[];
  let flagged = 0;
  for (const [userId, entries] of groupByUser(rows)) {
    if (entries.length < 3) continue;
    const total = entries.reduce((s, e) => s + e.valor, 0);
    if (total <= threshold) continue;
    if (hasRecentOpenReport(userId, 'fracionamento', 24)) continue;
    createSuspiciousActivityReport({
      userId,
      tipo: 'fracionamento',
      severidade: total > threshold * 3 ? 'critico' : 'atencao',
      descricao: `${entries.length} depósitos em 24h somando ${fmtBRL(total)}, cada um abaixo do limite de ${fmtBRL(threshold)} — padrão típico de fracionamento.`,
      evidencia: { entries, threshold, total },
    });
    flagged++;
    logger.info({ userId, total, threshold }, '[sar] fracionamento detectado');
  }
  return flagged;
}

// Rule 2: entrada e saída rápida (rapid pass-through / layering) — a deposit followed by
// a withdrawal of similar magnitude within 48h. A platform balance used only to
// momentarily hold funds, rather than to actually invest/receive, is a classic
// money-laundering layering signal.
export function detectEntradaSaidaRapida(): number {
  const rows = db
    .prepare(`SELECT id, user_id, valor, created_at FROM ledger WHERE created_at >= datetime('now', '-48 hours') ORDER BY created_at ASC, id ASC`)
    .all() as LedgerRow[];
  let flagged = 0;
  for (const [userId, entries] of groupByUser(rows)) {
    outer: for (let i = 0; i < entries.length; i++) {
      const dep = entries[i];
      if (dep.valor <= 0 || dep.valor < 5000) continue;
      for (let j = i + 1; j < entries.length; j++) {
        const wd = entries[j];
        if (wd.valor >= 0) continue;
        const ratio = Math.abs(wd.valor) / dep.valor;
        if (ratio < 0.85 || ratio > 1.15) continue; // only "similar magnitude" pairs
        const hoursApart = (new Date(wd.created_at).getTime() - new Date(dep.created_at).getTime()) / 3_600_000;
        if (hoursApart < 0 || hoursApart > 48) continue;
        if (hasRecentOpenReport(userId, 'entrada_saida_rapida', 48)) break outer;
        createSuspiciousActivityReport({
          userId,
          tipo: 'entrada_saida_rapida',
          severidade: hoursApart < 6 ? 'critico' : 'atencao',
          descricao: `Depósito de ${fmtBRL(dep.valor)} seguido de saque de ${fmtBRL(Math.abs(wd.valor))} em ${hoursApart.toFixed(1)}h — padrão típico de passagem rápida de recursos.`,
          evidencia: { deposito: dep, saque: wd, hoursApartRounded: +hoursApart.toFixed(1) },
        });
        flagged++;
        logger.info({ userId, hoursApart }, '[sar] entrada/saída rápida detectada');
        break outer;
      }
    }
  }
  return flagged;
}

export function runSuspiciousActivityScan(): { fracionamento: number; entradaSaidaRapida: number } {
  const fracionamento = detectFracionamento();
  const entradaSaidaRapida = detectEntradaSaidaRapida();
  return { fracionamento, entradaSaidaRapida };
}

// Only started from src/index.ts (never during tests/importing app.ts), same pattern as
// startHealthMonitor/startBackupJob/startAceiteReminderJob/startAutoEmitJob.
export function startSuspiciousActivityJob(intervalMs = 6 * 60 * 60 * 1000): NodeJS.Timeout {
  const run = () => {
    try {
      runSuspiciousActivityScan();
    } catch (err) {
      logger.error({ err }, '[sar] falha ao rodar varredura de atividade suspeita');
    }
  };
  run();
  return setInterval(run, intervalMs);
}
