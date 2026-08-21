import PDFDocument from 'pdfkit';
import type { Response } from 'express';
import { listPurchasesByInvestor } from '../db/duplicatas.js';
import { fmtBRL, parseFlexibleDate, toIsoUtc } from './format.js';

// Real Central Fiscal — informe de rendimentos. Retorno em direitos creditórios/recebíveis
// is taxed for a pessoa jurídica investor the same way renda fixa is: IRRF pela tabela
// regressiva (Lei 11.033/2004), calculada sobre o prazo entre a aplicação (compra) e o
// resgate (vencimento da duplicata). Lastro doesn't actually withhold anything today
// (settlePurchase credits the full retorno) — this is a real, correctly-computed estimate
// for the investor's own IR declaration, not a live withholding engine and not a DIRF
// submission to Receita Federal (that requires Lastro's own e-CNPJ digital certificate
// and access to Receita's Sped/DIRF system, which this sandbox can't have — same honest-gap
// discipline as lib/regulatoryReports.ts).
export interface IrBand {
  maxDias: number | null; // null = sem limite superior
  aliquota: number; // fração, ex. 0.225 = 22,5%
  label: string;
}

export const IR_REGRESSIVE_TABLE: IrBand[] = [
  { maxDias: 180, aliquota: 0.225, label: 'até 180 dias — 22,5%' },
  { maxDias: 360, aliquota: 0.2, label: '181 a 360 dias — 20%' },
  { maxDias: 720, aliquota: 0.175, label: '361 a 720 dias — 17,5%' },
  { maxDias: null, aliquota: 0.15, label: 'acima de 720 dias — 15%' },
];

export function aliquotaForDias(dias: number): IrBand {
  return IR_REGRESSIVE_TABLE.find((b) => b.maxDias === null || dias <= b.maxDias)!;
}

export interface IncomeTaxLine {
  duplicataId: string;
  sacado: string;
  dataAplicacao: string;
  dataResgate: string;
  diasCarencia: number;
  rendimentoBrutoFmt: string;
  aliquotaLabel: string;
  irEstimadoFmt: string;
  rendimentoLiquidoFmt: string;
}

export interface IncomeTaxStatement {
  year: number;
  investorName: string;
  lines: IncomeTaxLine[];
  totalRendimentoBrutoFmt: string;
  totalIrEstimadoFmt: string;
  totalRendimentoLiquidoFmt: string;
  operacoesCount: number;
}

export function buildIncomeTaxStatement(userId: number, investorName: string, year: number): IncomeTaxStatement {
  const purchases = listPurchasesByInvestor(userId).filter((p) => new Date(toIsoUtc(p.created_at)).getUTCFullYear() === year);

  let totalBruto = 0;
  let totalIr = 0;
  const lines: IncomeTaxLine[] = purchases.map((p) => {
    const dataAplicacao = new Date(toIsoUtc(p.created_at));
    const dataResgate = parseFlexibleDate(p.vencimento);
    const diasCarencia = Math.max(0, Math.round((dataResgate.getTime() - dataAplicacao.getTime()) / (24 * 3600 * 1000)));
    const band = aliquotaForDias(diasCarencia);
    const irEstimado = p.retorno * band.aliquota;
    const liquido = p.retorno - irEstimado;
    totalBruto += p.retorno;
    totalIr += irEstimado;
    return {
      duplicataId: p.duplicata_id,
      sacado: p.sacado_nome,
      dataAplicacao: dataAplicacao.toLocaleDateString('pt-BR'),
      dataResgate: dataResgate.toLocaleDateString('pt-BR'),
      diasCarencia,
      rendimentoBrutoFmt: fmtBRL(p.retorno),
      aliquotaLabel: band.label,
      irEstimadoFmt: fmtBRL(irEstimado),
      rendimentoLiquidoFmt: fmtBRL(liquido),
    };
  });

  return {
    year,
    investorName,
    lines,
    totalRendimentoBrutoFmt: fmtBRL(totalBruto),
    totalIrEstimadoFmt: fmtBRL(totalIr),
    totalRendimentoLiquidoFmt: fmtBRL(totalBruto - totalIr),
    operacoesCount: lines.length,
  };
}

export function streamIncomeTaxStatementPdf(res: Response, statement: IncomeTaxStatement) {
  const doc = new PDFDocument({ margin: 44, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="informe-rendimentos-${statement.year}.pdf"`);
  doc.pipe(res);

  doc.fontSize(16).fillColor('#0B1F3A').text(`Informe de Rendimentos — Ano-calendário ${statement.year}`);
  doc.moveDown(0.2);
  doc.fontSize(9.5).fillColor('#5B6472').text(statement.investorName);
  doc.fontSize(8.5).fillColor('#8B97AC').text(
    'Estimativa de IRRF pela tabela regressiva (Lei 11.033/2004) sobre operações reais desta conta — documento de apoio à declaração de IR, não uma DIRF formal. Lastro não retém imposto automaticamente hoje.'
  );
  doc.moveDown(1);

  const colX = [40, 200, 275, 340, 400, 460];
  const header = ['Sacado', 'Aplicação', 'Resgate', 'Dias', 'Rend. bruto', 'IR est.'];
  doc.fontSize(9).fillColor('#0B1F3A');
  header.forEach((h, i) => doc.text(h, colX[i], doc.y, { continued: i < header.length - 1, width: 90 }));
  doc.moveDown(0.4);
  doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor('#E4E8EE').stroke();
  doc.moveDown(0.3);

  for (const l of statement.lines) {
    const y = doc.y;
    doc.fontSize(8.5).fillColor('#0B1F3A');
    doc.text(l.sacado, colX[0], y, { width: 155 });
    doc.text(l.dataAplicacao, colX[1], y, { width: 70 });
    doc.text(l.dataResgate, colX[2], y, { width: 60 });
    doc.text(String(l.diasCarencia), colX[3], y, { width: 55 });
    doc.text(l.rendimentoBrutoFmt, colX[4], y, { width: 55 });
    doc.text(l.irEstimadoFmt, colX[5], y, { width: 95 });
    doc.moveDown(0.55);
  }

  if (statement.lines.length === 0) doc.fontSize(9.5).fillColor('#8B97AC').text('Nenhuma operação registrada neste ano-calendário.');

  doc.moveDown(1);
  doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor('#E4E8EE').stroke();
  doc.moveDown(0.5);
  doc.fontSize(10).fillColor('#0B1F3A');
  doc.font('Helvetica-Bold').text('Total rendimento bruto', { continued: true }).font('Helvetica').text(`: ${statement.totalRendimentoBrutoFmt}`);
  doc.font('Helvetica-Bold').text('Total IR estimado', { continued: true }).font('Helvetica').text(`: ${statement.totalIrEstimadoFmt}`);
  doc.font('Helvetica-Bold').text('Total rendimento líquido estimado', { continued: true }).font('Helvetica').text(`: ${statement.totalRendimentoLiquidoFmt}`);

  doc.end();
}
