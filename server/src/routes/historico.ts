import { z } from 'zod';
import { Router } from 'express';
import PDFDocument from 'pdfkit';
import { requireAuth } from '../auth/middleware.js';
import { listPurchasesByInvestor } from '../db/duplicatas.js';
import { effectiveOwnerId, getUserById, setInstitutionalReportingEnabled } from '../db/users.js';
import { planAtLeast } from '../lib/billing.js';
import { fmtAddOnPrice } from '../lib/addOnBilling.js';
import { buildInstitutionalAnalytics, streamInstitutionalReportPdf } from '../lib/institutionalReporting.js';
import { buildRebalanceView } from '../lib/portfolioRebalance.js';
import { buildIncomeTaxStatement, streamIncomeTaxStatementPdf } from '../lib/incomeTaxStatement.js';
import { buildPerformanceDashboard } from '../lib/investorPerformance.js';
import { fmtBRL, fmtBRLSigned, toIsoUtc } from '../lib/format.js';

export const historicoRouter = Router();
historicoRouter.use(requireAuth);

const INSTITUTIONAL_REPORTING_MIN_PLAN = 'pro';

// purchases.valor é valor de face numa compra primária/cesta/Confirming, mas preço pago
// numa compra originada de revenda (ver comentário de listPurchasesByInvestor em
// db/duplicatas.ts) — "Investido" precisa sempre ser o dinheiro que de fato saiu do
// bolso do investidor. Só vale recuperar via faceValor - retorno enquanto a posição
// ainda está ativa: retorno = faceValor - preço pago é uma identidade real enquanto a
// posição nunca foi revendida, mas deactivatePurchase (db/resaleListings.ts) sobrescreve
// retorno com o ganho/perda REALIZADO da revenda assim que a posição é fechada — nesse
// ponto p.valor (nunca tocado por deactivatePurchase) já é o registro correto e final de
// quanto foi investido para abrir aquela posição encerrada, e recalcular por cima dele
// corromperia um número que já estava certo.
function precoPago(p: { faceValor: number; retorno: number; valor: number; active: number }): number {
  return p.active ? p.faceValor - p.retorno : p.valor;
}

function rows(req: import('express').Request) {
  return listPurchasesByInvestor(effectiveOwnerId(req.user!)).map((p) => ({
    data: new Date(toIsoUtc(p.created_at)).toLocaleDateString('pt-BR'),
    empresa: p.sacado_nome,
    investidoFmt: fmtBRL(precoPago(p)),
    retornoFmt: fmtBRLSigned(p.retorno),
    status: 'Concluída',
    comRegresso: !!p.com_regresso,
  }));
}

historicoRouter.get('/', (req, res) => {
  const purchases = listPurchasesByInvestor(effectiveOwnerId(req.user!));
  const totalInvestido = purchases.reduce((sum, p) => sum + precoPago(p), 0);
  const totalRetorno = purchases.reduce((sum, p) => sum + p.retorno, 0);
  const rentMedia = totalInvestido > 0 ? (totalRetorno / totalInvestido) * 100 : 0;

  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
  const all = rows(req);

  res.json({
    totalInvestidoFmt: fmtBRL(totalInvestido),
    retornoAcumuladoFmt: fmtBRLSigned(totalRetorno),
    rentabilidadeMediaFmt: rentMedia.toFixed(1).replace('.', ',') + '% a.m.',
    historico: all.slice((page - 1) * pageSize, page * pageSize),
    page,
    pageSize,
    total: all.length,
  });
});

historicoRouter.get('/export.csv', (req, res) => {
  const all = rows(req);
  const header = 'Data,Empresa,Investido,Retorno,Status,ComRegresso';
  const lines = all.map((r) =>
    [r.data, csvEscape(r.empresa), csvEscape(r.investidoFmt), csvEscape(r.retornoFmt), r.status, r.comRegresso ? 'Sim' : 'Não'].join(',')
  );
  const csv = [header, ...lines].join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="historico.csv"');
  res.send(csv);
});

function csvEscape(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

historicoRouter.get('/export.pdf', (req, res) => {
  const all = rows(req);
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="historico.pdf"');
  doc.pipe(res);

  doc.fontSize(18).text('Lastro — Carteira & Histórico', { align: 'left' });
  doc.moveDown(0.3);
  doc.fontSize(10).fillColor('#5B6472').text(`${req.user!.company_name} — gerado em ${new Date().toLocaleString('pt-BR')}`);
  doc.moveDown(1);

  doc.fillColor('#0B1F3A').fontSize(11);
  const colX = [40, 140, 300, 400, 490];
  const header = ['Data', 'Empresa', 'Investido', 'Retorno', 'Status'];
  header.forEach((h, i) => doc.text(h, colX[i], doc.y, { continued: i < header.length - 1, width: 120 }));
  doc.moveDown(0.5);
  doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor('#E4E8EE').stroke();
  doc.moveDown(0.3);

  for (const r of all) {
    const y = doc.y;
    doc.fontSize(9.5).fillColor('#0B1F3A');
    doc.text(r.data, colX[0], y, { width: 95 });
    doc.text(r.empresa, colX[1], y, { width: 155 });
    doc.text(r.investidoFmt, colX[2], y, { width: 95 });
    doc.text(r.retornoFmt, colX[3], y, { width: 85 });
    doc.text(r.status, colX[4], y, { width: 65 });
    doc.moveDown(0.6);
  }

  if (all.length === 0) doc.fontSize(10).fillColor('#8B97AC').text('Nenhuma operação registrada ainda.');

  doc.end();
});

// Feature 5 — Institutional Reporting: a flat monthly subscription
// (lib/institutionalReporting.ts) unlocking portfolio-level analytics beyond the free
// per-transaction export above — rating concentration, insurance coverage, monthly
// performance trend and top exposures, plus a downloadable institutional PDF report.
// Requires the Pro plan or above; keyed by effectiveOwnerId so a team member account
// (which has no purchases of its own) always reads/toggles the owner's subscription.
historicoRouter.get('/institutional/status', (req, res) => {
  const owner = getUserById(effectiveOwnerId(req.user!))!;
  res.json({
    enabled: !!owner.institutional_reporting_enabled,
    priceFmt: fmtAddOnPrice('institutional_reporting'),
    planOk: planAtLeast(req.user!.plan, INSTITUTIONAL_REPORTING_MIN_PLAN),
    requiredPlan: INSTITUTIONAL_REPORTING_MIN_PLAN,
  });
});

const institutionalSubscribeSchema = z.object({ enabled: z.boolean() });

historicoRouter.post('/institutional/assinar', (req, res) => {
  if (!planAtLeast(req.user!.plan, INSTITUTIONAL_REPORTING_MIN_PLAN)) {
    res
      .status(402)
      .json({ error: 'plan_required', requiredPlan: INSTITUTIONAL_REPORTING_MIN_PLAN, message: 'Relatórios Institucionais está disponível a partir do plano Pro.' });
    return;
  }
  const parsed = institutionalSubscribeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
    return;
  }
  setInstitutionalReportingEnabled(effectiveOwnerId(req.user!), parsed.data.enabled);
  res.json({ enabled: parsed.data.enabled, priceFmt: fmtAddOnPrice('institutional_reporting') });
});

function requireInstitutionalReporting(req: import('express').Request, res: import('express').Response): boolean {
  const owner = getUserById(effectiveOwnerId(req.user!));
  if (!owner?.institutional_reporting_enabled) {
    res.status(402).json({ error: 'subscription_required', message: 'Assine Relatórios Institucionais para acessar este recurso.' });
    return false;
  }
  return true;
}

historicoRouter.get('/institutional/analytics', (req, res) => {
  if (!requireInstitutionalReporting(req, res)) return;
  res.json(buildInstitutionalAnalytics(effectiveOwnerId(req.user!)));
});

historicoRouter.get('/institutional/report.pdf', (req, res) => {
  if (!requireInstitutionalReporting(req, res)) return;
  const analytics = buildInstitutionalAnalytics(effectiveOwnerId(req.user!));
  streamInstitutionalReportPdf(res, req.user!.company_name, analytics);
});

// Suggested portfolio rebalancing (lib/portfolioRebalance.ts) — free for every investidor,
// unlike the paid Institutional Reporting analytics above: this is a smaller, targeted
// recommendation (rating/concentration drift vs. the investor's own suitability profile),
// not a full reporting suite. Returns a degenerate empty view for a cedente account (no
// purchases), same as GET /historico itself — no role check needed.
historicoRouter.get('/rebalanceamento', (req, res) => {
  res.json(buildRebalanceView(effectiveOwnerId(req.user!)));
});

function resolveYear(raw: unknown): number {
  const n = Number(raw);
  const currentYear = new Date().getUTCFullYear();
  if (Number.isInteger(n) && n >= 2020 && n <= currentYear) return n;
  return currentYear;
}

// Central fiscal — informe de rendimentos (lib/incomeTaxStatement.ts). Free for every
// investidor, same as the rebalancing suggestions above — no paid-subscription gate.
historicoRouter.get('/informe-rendimentos', (req, res) => {
  const owner = getUserById(effectiveOwnerId(req.user!))!;
  const year = resolveYear(req.query.year);
  res.json(buildIncomeTaxStatement(owner.id, owner.company_name, year));
});

historicoRouter.get('/informe-rendimentos.pdf', (req, res) => {
  const owner = getUserById(effectiveOwnerId(req.user!))!;
  const year = resolveYear(req.query.year);
  const statement = buildIncomeTaxStatement(owner.id, owner.company_name, year);
  streamIncomeTaxStatementPdf(res, statement);
});

// Risk-adjusted performance (lib/investorPerformance.ts) — free for every investidor, same
// as the rebalancing suggestions and informe de rendimentos above. `year` is optional
// (all-time when omitted, unlike informe-rendimentos which always resolves to a specific
// year); `riskFree` is caller-supplied, never a hardcoded "current CDI/SELIC" this codebase
// has no live, verified source for.
function resolveOptionalYear(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  const currentYear = new Date().getUTCFullYear();
  if (Number.isInteger(n) && n >= 2020 && n <= currentYear) return n;
  return null;
}

function resolveRiskFree(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(-50, Math.min(50, n)) : 0;
}

historicoRouter.get('/performance', (req, res) => {
  const owner = effectiveOwnerId(req.user!);
  const year = resolveOptionalYear(req.query.year);
  const riskFreeRateAnnualPct = resolveRiskFree(req.query.riskFree);
  res.json(buildPerformanceDashboard(owner, { year, riskFreeRateAnnualPct }));
});
