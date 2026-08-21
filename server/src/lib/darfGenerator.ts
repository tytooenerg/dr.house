import PDFDocument from 'pdfkit';
import type { Response } from 'express';
import { db } from '../db/index.js';
import { fmtBRL, toIsoUtc } from './format.js';
import { aliquotaForDias } from './incomeTaxStatement.js';

// Real DARF (Documento de Arrecadação de Receitas Federais) generation from the same IR
// regressive-table math lib/incomeTaxStatement.ts already computes per investor — but this
// is the other side of that same obligation: incomeTaxStatement.ts is the investor's own
// informe (a document to help *them* declare); this is the platform's own aggregate
// recolhimento, because for renda-fixa-style IRRF the fonte pagadora — Lastro — is who
// actually owes Receita Federal the withheld amount, not each investor individually.
//
// Same honesty discipline as docs/postgres-migration.md, lib/regulatoryReports.ts and
// lib/esignature.ts: this computes a real total from real data using a real, long-standing
// DARF código de receita (3426 — IRRF sobre rendimentos de aplicações financeiras de renda
// fixa) and a commonly-used due-date rule (último dia útil do mês subsequente), but it does
// not file or pay anything — Lastro doesn't actually withhold IR today (settlePurchase
// credits the full retorno, see incomeTaxStatement.ts), so this DARF is a real, correctly
// computed "what Lastro would owe if it were withholding", not a live recolhimento. Confirm
// the exact código de receita and due-date rule against current Receita Federal legislation
// before treating this as a real guia to pay — it is not a substitute for accounting/tax advice.
export const DARF_CODIGO_RECEITA = '3426';
export const DARF_CODIGO_RECEITA_LABEL = 'IRRF — Rendimentos de Aplicações Financeiras de Renda Fixa';

function monthRange(period: string): { start: string; end: string } {
  const [y, m] = period.split('-').map(Number);
  const start = `${period}-01`;
  const end = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  return { start, end };
}

// Simplified — the real rule varies by código de receita; this uses the last calendar day
// of the month following the competência as a reasonable, commonly-cited default, and is
// labeled as such wherever it's shown (see the honesty note above).
function estimatedDueDate(period: string): string {
  const [y, m] = period.split('-').map(Number);
  const lastDayNextMonth = new Date(Date.UTC(y, m + 1, 0));
  return lastDayNextMonth.toISOString().slice(0, 10);
}

export interface DarfLine {
  duplicataId: string;
  investorId: number;
  investorName: string;
  vencimento: string;
  diasCarencia: number;
  rendimentoBrutoFmt: string;
  aliquotaLabel: string;
  irEstimadoFmt: string;
}

export interface DarfSummary {
  period: string;
  codigoReceita: string;
  codigoReceitaLabel: string;
  dataVencimento: string;
  lines: DarfLine[];
  operacoesCount: number;
  valorPrincipal: number;
  valorPrincipalFmt: string;
  valorMultaFmt: string;
  valorJurosFmt: string;
  valorTotalFmt: string;
}

// Taxable event is resgate (vencimento) — same as incomeTaxStatement.ts's per-line logic —
// aggregated here across every investor whose position matured within the competência month.
export function buildDarfSummary(period: string): DarfSummary {
  const { start, end } = monthRange(period);
  const rows = db
    .prepare(
      `SELECT p.duplicata_id, p.investor_id, p.retorno, p.created_at, u.company_name as investor_name, d.vencimento as vencimento
       FROM purchases p
       JOIN users u ON u.id = p.investor_id
       JOIN duplicatas d ON d.id = p.duplicata_id
       WHERE d.sandbox = 0 AND d.vencimento >= ? AND d.vencimento < ?
       ORDER BY d.vencimento ASC`
    )
    .all(start, end) as { duplicata_id: string; investor_id: number; retorno: number; created_at: string; investor_name: string; vencimento: string }[];

  let valorPrincipal = 0;
  const lines: DarfLine[] = rows.map((r) => {
    const dataAplicacao = new Date(toIsoUtc(r.created_at));
    const dataResgate = new Date(r.vencimento);
    const diasCarencia = Math.max(0, Math.round((dataResgate.getTime() - dataAplicacao.getTime()) / (24 * 3600 * 1000)));
    const band = aliquotaForDias(diasCarencia);
    const irEstimado = r.retorno * band.aliquota;
    valorPrincipal += irEstimado;
    return {
      duplicataId: r.duplicata_id,
      investorId: r.investor_id,
      investorName: r.investor_name,
      vencimento: dataResgate.toLocaleDateString('pt-BR'),
      diasCarencia,
      rendimentoBrutoFmt: fmtBRL(r.retorno),
      aliquotaLabel: band.label,
      irEstimadoFmt: fmtBRL(irEstimado),
    };
  });

  return {
    period,
    codigoReceita: DARF_CODIGO_RECEITA,
    codigoReceitaLabel: DARF_CODIGO_RECEITA_LABEL,
    dataVencimento: new Date(estimatedDueDate(period)).toLocaleDateString('pt-BR'),
    lines,
    operacoesCount: lines.length,
    valorPrincipal,
    valorPrincipalFmt: fmtBRL(valorPrincipal),
    valorMultaFmt: fmtBRL(0),
    valorJurosFmt: fmtBRL(0),
    valorTotalFmt: fmtBRL(valorPrincipal),
  };
}

export function streamDarfPdf(res: Response, summary: DarfSummary) {
  const doc = new PDFDocument({ margin: 44, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="darf-irrf-${summary.period}.pdf"`);
  doc.pipe(res);

  doc.fontSize(16).fillColor('#0B1F3A').text('DARF — Documento de Arrecadação de Receitas Federais (estimado)');
  doc.moveDown(0.2);
  doc.fontSize(9.5).fillColor('#5B6472').text(`Período de apuração: ${summary.period}`);
  doc.fontSize(8.5).fillColor('#8B97AC').text(
    `Código de receita ${summary.codigoReceita} — ${summary.codigoReceitaLabel}. Data de vencimento estimada (regra padrão, confirme o prazo exato do código de receita junto à Receita Federal): ${summary.dataVencimento}. Documento de apoio ao recolhimento agregado de IRRF sobre os resgates deste período — não uma guia protocolada; Lastro não retém IR automaticamente hoje (ver Central Fiscal). Não substitui orientação contábil/tributária.`,
    { width: 500 }
  );
  doc.moveDown(1);

  const colX = [40, 210, 280, 335, 400, 470];
  const header = ['Investidor', 'Vencimento', 'Dias', 'Rend. bruto', 'Alíquota', 'IR estimado'];
  doc.fontSize(9).fillColor('#0B1F3A');
  header.forEach((h, i) => doc.text(h, colX[i], doc.y, { continued: i < header.length - 1, width: 90 }));
  doc.moveDown(0.4);
  doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor('#E4E8EE').stroke();
  doc.moveDown(0.3);

  for (const l of summary.lines) {
    const y = doc.y;
    doc.fontSize(8).fillColor('#0B1F3A');
    doc.text(l.investorName, colX[0], y, { width: 165 });
    doc.text(l.vencimento, colX[1], y, { width: 65 });
    doc.text(String(l.diasCarencia), colX[2], y, { width: 50 });
    doc.text(l.rendimentoBrutoFmt, colX[3], y, { width: 60 });
    doc.fontSize(6.5).text(l.aliquotaLabel, colX[4], y, { width: 65 });
    doc.fontSize(8).text(l.irEstimadoFmt, colX[5], y, { width: 85 });
    doc.moveDown(0.55);
  }

  if (summary.lines.length === 0) doc.fontSize(9.5).fillColor('#8B97AC').text('Nenhum resgate registrado neste período de apuração.');

  doc.moveDown(1);
  doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor('#E4E8EE').stroke();
  doc.moveDown(0.5);
  doc.fontSize(10).fillColor('#0B1F3A');
  doc.font('Helvetica-Bold').text('Valor principal', { continued: true }).font('Helvetica').text(`: ${summary.valorPrincipalFmt}`);
  doc.font('Helvetica-Bold').text('Multa', { continued: true }).font('Helvetica').text(`: ${summary.valorMultaFmt}`);
  doc.font('Helvetica-Bold').text('Juros', { continued: true }).font('Helvetica').text(`: ${summary.valorJurosFmt}`);
  doc.font('Helvetica-Bold').text('Valor total', { continued: true }).font('Helvetica').text(`: ${summary.valorTotalFmt}`);

  doc.end();
}
