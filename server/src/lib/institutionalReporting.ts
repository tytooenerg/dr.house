import PDFDocument from 'pdfkit';
import type { Response } from 'express';
import { listPurchasesByInvestor } from '../db/duplicatas.js';
import { listUsersWithInstitutionalReporting } from '../db/users.js';
import { chargeOncePerPeriod, fmtAddOnPrice } from './addOnBilling.js';
import { ratingFromScore } from './riscoCore.js';
import { fmtBRL, fmtBRLSigned, toIsoUtc } from './format.js';
import { logger } from './logger.js';
import type { Rating } from '../data/seed.js';

// Feature 5 — Institutional Reporting: a flat monthly subscription (lib/addOnBilling.ts,
// kind='institutional_reporting') for portfolio-level analytics that go beyond the free
// per-transaction Carteira & Histórico export (routes/historico.ts) — rating concentration,
// insurance coverage, monthly performance trend and top exposures, aggregated server-side
// from the investor's own real purchases (never fabricated). Independent of plan tier, same
// as White-label Plus: an investor either subscribes or doesn't.

export interface InstitutionalAnalytics {
  totalInvestidoFmt: string;
  retornoAcumuladoFmt: string;
  rentabilidadeMediaFmt: string;
  posicoesAtivas: number;
  comRegressoPct: number;
  comSeguroPct: number;
  ratingDistribution: { rating: Rating; valor: number; valorFmt: string; pct: number }[];
  desempenhoMensal: { mes: string; investidoFmt: string; retornoFmt: string }[];
  maioresExposicoes: { sacado: string; valorFmt: string; pct: number }[];
}

export function buildInstitutionalAnalytics(investorId: number): InstitutionalAnalytics {
  const purchases = listPurchasesByInvestor(investorId);
  const totalInvestido = purchases.reduce((sum, p) => sum + p.valor, 0);
  const totalRetorno = purchases.reduce((sum, p) => sum + p.retorno, 0);
  const rentMedia = totalInvestido > 0 ? (totalRetorno / totalInvestido) * 100 : 0;
  const comRegresso = purchases.filter((p) => p.com_regresso).length;
  const comSeguro = purchases.filter((p) => p.seguro).length;

  const ratingTotals: Record<Rating, number> = { AA: 0, A: 0, B: 0, C: 0 };
  for (const p of purchases) {
    const rating = ratingFromScore(p.score ?? 50);
    ratingTotals[rating] += p.valor;
  }
  const ratingDistribution = (Object.keys(ratingTotals) as Rating[]).map((rating) => ({
    rating,
    valor: ratingTotals[rating],
    valorFmt: fmtBRL(ratingTotals[rating]),
    pct: totalInvestido > 0 ? Math.round((ratingTotals[rating] / totalInvestido) * 100) : 0,
  }));

  const monthlyTotals = new Map<string, { investido: number; retorno: number }>();
  for (const p of purchases) {
    const mes = new Date(toIsoUtc(p.created_at)).toISOString().slice(0, 7);
    const entry = monthlyTotals.get(mes) ?? { investido: 0, retorno: 0 };
    entry.investido += p.valor;
    entry.retorno += p.retorno;
    monthlyTotals.set(mes, entry);
  }
  const desempenhoMensal = [...monthlyTotals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([mes, t]) => ({ mes, investidoFmt: fmtBRL(t.investido), retornoFmt: fmtBRLSigned(t.retorno) }));

  const sacadoTotals = new Map<string, number>();
  for (const p of purchases) sacadoTotals.set(p.sacado_nome, (sacadoTotals.get(p.sacado_nome) ?? 0) + p.valor);
  const maioresExposicoes = [...sacadoTotals.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([sacado, valor]) => ({ sacado, valorFmt: fmtBRL(valor), pct: totalInvestido > 0 ? Math.round((valor / totalInvestido) * 100) : 0 }));

  return {
    totalInvestidoFmt: fmtBRL(totalInvestido),
    retornoAcumuladoFmt: fmtBRLSigned(totalRetorno),
    rentabilidadeMediaFmt: rentMedia.toFixed(1).replace('.', ',') + '% a.m.',
    posicoesAtivas: purchases.filter((p) => p.active).length,
    comRegressoPct: purchases.length > 0 ? Math.round((comRegresso / purchases.length) * 100) : 0,
    comSeguroPct: purchases.length > 0 ? Math.round((comSeguro / purchases.length) * 100) : 0,
    ratingDistribution,
    desempenhoMensal,
    maioresExposicoes,
  };
}

export function streamInstitutionalReportPdf(res: Response, companyName: string, analytics: InstitutionalAnalytics) {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="relatorio-institucional.pdf"');
  doc.pipe(res);

  doc.fontSize(18).fillColor('#0B1F3A').text('Lastro — Relatório Institucional');
  doc.moveDown(0.3);
  doc.fontSize(10).fillColor('#5B6472').text(`${companyName} — gerado em ${new Date().toLocaleString('pt-BR')}`);
  doc.moveDown(1);

  doc.fontSize(12).fillColor('#0B1F3A').text('Resumo da carteira');
  doc.moveDown(0.3);
  doc.fontSize(10).fillColor('#0B1F3A');
  doc.text(`Total investido: ${analytics.totalInvestidoFmt}`);
  doc.text(`Retorno acumulado: ${analytics.retornoAcumuladoFmt}`);
  doc.text(`Rentabilidade média: ${analytics.rentabilidadeMediaFmt}`);
  doc.text(`Posições ativas: ${analytics.posicoesAtivas}`);
  doc.text(`Com direito de regresso: ${analytics.comRegressoPct}%`);
  doc.text(`Com seguro de crédito: ${analytics.comSeguroPct}%`);
  doc.moveDown(1);

  doc.fontSize(12).fillColor('#0B1F3A').text('Distribuição por rating');
  doc.moveDown(0.3);
  doc.fontSize(10);
  for (const r of analytics.ratingDistribution) {
    doc.text(`${r.rating}: ${r.valorFmt} (${r.pct}%)`);
  }
  doc.moveDown(1);

  doc.fontSize(12).fillColor('#0B1F3A').text('Maiores exposições (sacado)');
  doc.moveDown(0.3);
  doc.fontSize(10);
  if (analytics.maioresExposicoes.length === 0) doc.fillColor('#8B97AC').text('Nenhuma operação registrada ainda.');
  for (const e of analytics.maioresExposicoes) {
    doc.fillColor('#0B1F3A').text(`${e.sacado}: ${e.valorFmt} (${e.pct}%)`);
  }
  doc.moveDown(1);

  doc.fontSize(12).fillColor('#0B1F3A').text('Desempenho mensal');
  doc.moveDown(0.3);
  doc.fontSize(10);
  if (analytics.desempenhoMensal.length === 0) doc.fillColor('#8B97AC').text('Nenhuma operação registrada ainda.');
  for (const m of analytics.desempenhoMensal) {
    doc.fillColor('#0B1F3A').text(`${m.mes}: investido ${m.investidoFmt} — retorno ${m.retornoFmt}`);
  }

  doc.end();
}

export interface InstitutionalReportingBillingResult {
  period: string;
  charged: number;
  skipped: number;
}

export async function runInstitutionalReportingBilling(period?: string): Promise<InstitutionalReportingBillingResult> {
  const users = listUsersWithInstitutionalReporting();
  let charged = 0;
  let skipped = 0;
  for (const user of users) {
    const result = await chargeOncePerPeriod(
      user.id,
      'institutional_reporting',
      1,
      `Assinatura Relatórios Institucionais (${fmtAddOnPrice('institutional_reporting')}/mês)`,
      period
    );
    if (result) {
      charged++;
      logger.info({ userId: user.id }, '[institutional-reporting] cobrança mensal registrada');
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
export function startInstitutionalReportingBillingJob(intervalMs = 24 * 60 * 60 * 1000): NodeJS.Timeout {
  const run = () => {
    runInstitutionalReportingBilling(previousMonthKey()).catch((err) =>
      logger.error({ err }, '[institutional-reporting] falha ao rodar cobrança mensal')
    );
  };
  run();
  return setInterval(run, intervalMs);
}
