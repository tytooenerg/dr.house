import { PassThrough } from 'node:stream';
import type { Response } from 'express';
import { buildCvmPeriodStats, streamCvmReportPdf } from './regulatoryReports.js';
import { buildDarfSummary, streamDarfPdf } from './darfGenerator.js';
import { getPlatformSetting, setPlatformSetting } from '../db/platformSettings.js';
import { sendEmail } from './mailer.js';
import { db } from '../db/index.js';
import { logger } from './logger.js';

const LAST_SENT_KEY = 'monthly_regulatory_reports_last_period';

// CVM informe + DARF (lib/regulatoryReports.ts, lib/darfGenerator.ts) are both real, already
// fully built — the only thing manual was an admin having to remember to open Back-office →
// Compliance, pick last month, and click "baixar" twice, every month, forever. This turns
// that into: generate both for the month that just closed, and email them to every admin
// automatically. Neither becomes a real regulatory filing by being emailed — same "documento
// de apoio a compliance, não protocolo formal" disclaimer both PDFs already print on
// themselves; this only removes the reminder-to-click, not the human decision of what to do
// with the document.
function previousMonthPeriod(): string {
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
}

// streamCvmReportPdf/streamDarfPdf both write directly to an Express Response (pdfkit's
// doc.pipe(res)) — there's no res in a cron job. Rather than forking the tested PDF-drawing
// code in regulatoryReports.ts/darfGenerator.ts into a second "return a Buffer" variant,
// this collects the exact same stream into a Buffer via a minimal Response-shaped sink
// (setHeader is the only Response method either function calls before piping).
async function collectPdf(streamFn: (res: Response, arg: any) => void, arg: unknown): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const sink = new PassThrough();
    const chunks: Buffer[] = [];
    sink.on('data', (chunk) => chunks.push(chunk));
    sink.on('end', () => resolve(Buffer.concat(chunks)));
    sink.on('error', reject);
    const fakeRes = Object.assign(sink, { setHeader: () => {} }) as unknown as Response;
    streamFn(fakeRes, arg);
  });
}

export async function runMonthlyRegulatoryReports(): Promise<{ sent: boolean; period: string }> {
  const period = previousMonthPeriod();
  if (getPlatformSetting(LAST_SENT_KEY) === period) {
    // Already sent for this period (e.g. the job restarted the same day) — never double-send.
    return { sent: false, period };
  }

  const admins = db.prepare("SELECT email FROM users WHERE role = 'admin' AND deleted_at IS NULL").all() as { email: string }[];
  if (admins.length === 0) return { sent: false, period };

  const cvmStats = buildCvmPeriodStats(period);
  const darfSummary = buildDarfSummary(period);
  const [cvmPdf, darfPdf] = await Promise.all([collectPdf(streamCvmReportPdf, cvmStats), collectPdf(streamDarfPdf, darfSummary)]);

  const text = [
    `Informe CVM e DARF do período ${period}, gerados automaticamente — documentos de apoio a compliance, não protocolos formais.`,
    '',
    `CVM — duplicatas emitidas: ${cvmStats.totalEmitidoCount} (${cvmStats.totalEmitidoFmt}), volume 1º mercado: ${cvmStats.totalMercadoPrimarioFmt}, 2º mercado: ${cvmStats.totalMercadoSecundarioFmt}.`,
    `DARF — ver PDF anexo para o IRRF agregado do período.`,
    '',
    'Revise em Back-office → Compliance antes de qualquer uso formal.',
  ].join('\n');

  for (const a of admins) {
    await sendEmail(a.email, `Lastro — informe CVM e DARF de ${period}`, text, [
      { filename: `cvm-informe-${period}.pdf`, content: cvmPdf, contentType: 'application/pdf' },
      { filename: `darf-irrf-${period}.pdf`, content: darfPdf, contentType: 'application/pdf' },
    ]);
  }

  setPlatformSetting(LAST_SENT_KEY, period);
  logger.info({ period, admins: admins.length }, '[monthly-regulatory-reports] enviado');
  return { sent: true, period };
}

// Runs once a day (cheap — the dedup guard above makes every call after the first of the
// month a no-op) rather than trying to schedule for exactly midnight on the 1st, same
// pragmatic approach every other *Job.ts in this codebase already uses for its own cadence.
export function startMonthlyRegulatoryReportsJob(intervalMs = 24 * 60 * 60 * 1000): NodeJS.Timeout {
  void runMonthlyRegulatoryReports();
  return setInterval(() => void runMonthlyRegulatoryReports(), intervalMs);
}
