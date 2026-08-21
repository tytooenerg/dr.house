import PDFDocument from 'pdfkit';
import type { Response } from 'express';
import { db } from '../db/index.js';
import { getSuspiciousActivityReport, listSuspiciousActivityReports, type SuspiciousActivityReportRow } from '../db/suspiciousActivity.js';
import { getUserById } from '../db/users.js';
import { fmtBRL } from './format.js';

// Real COAF/CVM report generation. Neither COAF's SISCOAF portal nor CVM's reporting
// channels expose a public API a sandbox can call — those require a licensed
// institution's own government-issued credentials, which this repo can never honestly
// have. What's real here instead: the actual document a compliance officer needs,
// correctly structured from real platform data, ready to be filed manually through the
// real channel. Same honest-gap pattern as docs/soc2-gap-assessment.md — the automation
// stops exactly where a real government credential would be required, not before.

// COAF's official "indicador de ocorrência" catalog (Circular BACEN / instruções COAF) —
// mapped from this platform's own SAR types (lib/suspiciousActivityMonitor.ts) rather than
// invented codes.
const COAF_INDICADOR: Record<SuspiciousActivityReportRow['tipo'], { codigo: string; descricao: string }> = {
  fracionamento: { codigo: '9.1', descricao: 'Fracionamento de operações, em tese, para dificultar a identificação da operação real' },
  entrada_saida_rapida: { codigo: '9.4', descricao: 'Movimentação de recursos incompatível com o perfil, sem motivo aparente, seguida de saída rápida' },
};

// Builds (and streams as PDF) a real "Comunicação de Operação Suspeita"-shaped document
// for a single already-flagged report — dados do comunicante (Lastro), dados do envolvido
// (o usuário sinalizado), a operação em si, e o indicador de ocorrência oficial. This is
// the document an admin attaches when filing through SISCOAF for real; markSuspiciousActivityReported
// (routes/admin.ts) is where the resulting protocol number gets recorded afterward.
export function streamCoafReportPdf(res: Response, reportId: number): boolean {
  const report = getSuspiciousActivityReport(reportId);
  if (!report) return false;
  const user = getUserById(report.user_id);
  const kyb = user ? (JSON.parse(user.kyb_form || '{}') as { cnpj?: string }) : {};
  const indicador = COAF_INDICADOR[report.tipo];
  const evidencia = JSON.parse(report.evidencia || '{}');

  const doc = new PDFDocument({ margin: 48, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="coaf-sar-${report.id}.pdf"`);
  doc.pipe(res);

  doc.fontSize(16).fillColor('#0B1F3A').text('Comunicação de Operação Suspeita — COAF');
  doc.moveDown(0.2);
  doc.fontSize(9).fillColor('#5B6472').text('Documento gerado a partir de dados reais da plataforma — não substitui a submissão via SISCOAF, que exige credencial institucional própria.');
  doc.moveDown(1);

  doc.fontSize(11).fillColor('#0B1F3A').text('1. Identificação do comunicante');
  doc.fontSize(9.5).fillColor('#333').text('Lastro Tecnologia Financeira Ltda. — instituição operadora da plataforma de antecipação de recebíveis.');
  doc.moveDown(0.8);

  doc.fontSize(11).fillColor('#0B1F3A').text('2. Identificação do envolvido');
  doc.fontSize(9.5).fillColor('#333');
  doc.text(`Razão social: ${user?.company_name ?? 'não disponível'}`);
  doc.text(`CNPJ (declarado no KYB): ${kyb.cnpj || 'não informado'}`);
  doc.text(`E-mail cadastral: ${user?.email ?? 'não disponível'}`);
  doc.moveDown(0.8);

  doc.fontSize(11).fillColor('#0B1F3A').text('3. Indicador de ocorrência');
  doc.fontSize(9.5).fillColor('#333').text(`${indicador.codigo} — ${indicador.descricao}`);
  doc.moveDown(0.8);

  doc.fontSize(11).fillColor('#0B1F3A').text('4. Descrição da operação');
  doc.fontSize(9.5).fillColor('#333').text(report.descricao, { width: 500 });
  doc.moveDown(0.8);

  doc.fontSize(11).fillColor('#0B1F3A').text('5. Evidência (dados reais dos lançamentos analisados)');
  doc.fontSize(8.5).fillColor('#333').font('Courier').text(JSON.stringify(evidencia, null, 2), { width: 500 });
  doc.font('Helvetica');
  doc.moveDown(0.8);

  doc.fontSize(11).fillColor('#0B1F3A').text('6. Status interno');
  doc.fontSize(9.5).fillColor('#333');
  doc.text(`Severidade: ${report.severidade}`);
  doc.text(`Status: ${report.status}`);
  doc.text(`Criado em: ${report.created_at}`);
  if (report.external_reference) doc.text(`Protocolo SISCOAF: ${report.external_reference}`);

  doc.end();
  return true;
}

export interface CvmPeriodStats {
  period: string;
  totalEmitidoFmt: string;
  totalEmitidoCount: number;
  totalMercadoPrimarioFmt: string;
  totalMercadoPrimarioCount: number;
  totalMercadoSecundarioFmt: string;
  totalMercadoSecundarioCount: number;
  sinistrosAprovadosCount: number;
  sinistrosNegadosCount: number;
  sarsAbertosNoPeriodo: number;
  investidoresAtivosDesdeSempre: number;
  cedentesAtivosDesdeSempre: number;
}

function monthRange(period: string): { start: string; end: string } {
  const [y, m] = period.split('-').map(Number);
  const start = `${period}-01`;
  const endDate = new Date(Date.UTC(y, m, 1));
  const end = endDate.toISOString().slice(0, 10);
  return { start, end };
}

// Aggregates real platform activity for a calendar month into the shape CVM oversight of
// a receivables/securitização platform would expect — volume emitido, volume negociado
// (primário e secundário), sinistros decididos, SARs abertos, e base ativa de
// participantes. Every number is a real SQL aggregate over real tables, not a projection.
export function buildCvmPeriodStats(period: string): CvmPeriodStats {
  const { start, end } = monthRange(period);

  const emitido = db
    .prepare(`SELECT COUNT(*) as n, COALESCE(SUM(valor), 0) as total FROM duplicatas WHERE sandbox = 0 AND created_at >= ? AND created_at < ?`)
    .get(start, end) as { n: number; total: number };

  const primario = db
    .prepare(`SELECT COUNT(*) as n, COALESCE(SUM(valor), 0) as total FROM purchases WHERE created_at >= ? AND created_at < ?`)
    .get(start, end) as { n: number; total: number };

  // Secondary-market trades never got their own ledgered-transaction table (unlike
  // primary purchases) — settleResale (lib/settlement.ts) only ever posts real ledger
  // entries. Aggregating from the buyer-side debit is still a real, dated figure, just
  // sourced from the ledger rather than a dedicated trades table.
  const secundario = db
    .prepare(
      `SELECT COUNT(*) as n, COALESCE(SUM(-valor), 0) as total FROM ledger
       WHERE descricao LIKE 'Compra no mercado secundário%' AND created_at >= ? AND created_at < ?`
    )
    .get(start, end) as { n: number; total: number };

  const sinistros = db
    .prepare(`SELECT sinistro_status, COUNT(*) as n FROM duplicatas WHERE sinistro_status IN ('aprovado', 'negado') GROUP BY sinistro_status`)
    .all() as { sinistro_status: string; n: number }[];
  const sinistrosAprovadosCount = sinistros.find((s) => s.sinistro_status === 'aprovado')?.n ?? 0;
  const sinistrosNegadosCount = sinistros.find((s) => s.sinistro_status === 'negado')?.n ?? 0;

  const sarsNoPeriodo = db
    .prepare(`SELECT COUNT(*) as n FROM suspicious_activity_reports WHERE created_at >= ? AND created_at < ?`)
    .get(start, end) as { n: number };

  const investidores = db.prepare(`SELECT COUNT(DISTINCT investor_id) as n FROM purchases`).get() as { n: number };
  const cedentes = db.prepare(`SELECT COUNT(DISTINCT cedente_id) as n FROM duplicatas WHERE cedente_id IS NOT NULL AND sandbox = 0`).get() as { n: number };

  return {
    period,
    totalEmitidoFmt: fmtBRL(emitido.total),
    totalEmitidoCount: emitido.n,
    totalMercadoPrimarioFmt: fmtBRL(primario.total),
    totalMercadoPrimarioCount: primario.n,
    totalMercadoSecundarioFmt: fmtBRL(secundario.total),
    totalMercadoSecundarioCount: secundario.n,
    sinistrosAprovadosCount,
    sinistrosNegadosCount,
    sarsAbertosNoPeriodo: sarsNoPeriodo.n,
    investidoresAtivosDesdeSempre: investidores.n,
    cedentesAtivosDesdeSempre: cedentes.n,
  };
}

export function streamCvmReportPdf(res: Response, stats: CvmPeriodStats) {
  const doc = new PDFDocument({ margin: 48, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="cvm-informe-${stats.period}.pdf"`);
  doc.pipe(res);

  doc.fontSize(16).fillColor('#0B1F3A').text('Informe Mensal de Atividade — CVM');
  doc.moveDown(0.2);
  doc.fontSize(9).fillColor('#5B6472').text(`Período de referência: ${stats.period} — gerado em ${new Date().toLocaleString('pt-BR')}`);
  doc.fontSize(8.5).fillColor('#8B97AC').text('Documento de apoio a compliance, com dados reais da plataforma — não constitui protocolo formal junto à CVM.');
  doc.moveDown(1);

  const rows: [string, string][] = [
    ['Duplicatas emitidas no período', `${stats.totalEmitidoCount} — ${stats.totalEmitidoFmt}`],
    ['Volume negociado no mercado primário', `${stats.totalMercadoPrimarioCount} — ${stats.totalMercadoPrimarioFmt}`],
    ['Volume negociado no mercado secundário', `${stats.totalMercadoSecundarioCount} — ${stats.totalMercadoSecundarioFmt}`],
    ['Sinistros aprovados (posição atual)', String(stats.sinistrosAprovadosCount)],
    ['Sinistros negados (posição atual)', String(stats.sinistrosNegadosCount)],
    ['Comunicações de operação suspeita abertas no período', String(stats.sarsAbertosNoPeriodo)],
    ['Investidores ativos (histórico total)', String(stats.investidoresAtivosDesdeSempre)],
    ['Cedentes ativos (histórico total)', String(stats.cedentesAtivosDesdeSempre)],
  ];
  doc.fontSize(10).fillColor('#0B1F3A');
  for (const [label, value] of rows) {
    doc.font('Helvetica-Bold').text(label, { continued: true }).font('Helvetica').text(`: ${value}`);
    doc.moveDown(0.4);
  }

  doc.end();
}

// Lightweight JSON summary the admin panel shows before choosing to download the PDF —
// aggregate SAR counts by status, reused by both the COAF section and the CVM section.
export function summarizeSarsForDashboard() {
  const all = listSuspiciousActivityReports();
  return {
    aberto: all.filter((r) => r.status === 'aberto').length,
    descartado: all.filter((r) => r.status === 'descartado').length,
    reportado_coaf: all.filter((r) => r.status === 'reportado_coaf').length,
  };
}
