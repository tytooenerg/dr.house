import { Router } from 'express';
import PDFDocument from 'pdfkit';
import { requireAuth } from '../auth/middleware.js';
import { listPurchasesByInvestor } from '../db/duplicatas.js';
import { fmtBRL, toIsoUtc } from '../lib/format.js';

export const historicoRouter = Router();
historicoRouter.use(requireAuth);

function rows(req: import('express').Request) {
  return listPurchasesByInvestor(req.user!.id).map((p) => ({
    data: new Date(toIsoUtc(p.created_at)).toLocaleDateString('pt-BR'),
    empresa: p.sacado_nome,
    investidoFmt: fmtBRL(p.valor),
    retornoFmt: '+' + fmtBRL(p.retorno),
    status: 'Concluída',
  }));
}

historicoRouter.get('/', (req, res) => {
  const purchases = listPurchasesByInvestor(req.user!.id);
  const totalInvestido = purchases.reduce((sum, p) => sum + p.valor, 0);
  const totalRetorno = purchases.reduce((sum, p) => sum + p.retorno, 0);
  const rentMedia = totalInvestido > 0 ? (totalRetorno / totalInvestido) * 100 : 0;

  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
  const all = rows(req);

  res.json({
    totalInvestidoFmt: fmtBRL(totalInvestido),
    retornoAcumuladoFmt: '+' + fmtBRL(totalRetorno),
    rentabilidadeMediaFmt: rentMedia.toFixed(1).replace('.', ',') + '% a.m.',
    historico: all.slice((page - 1) * pageSize, page * pageSize),
    page,
    pageSize,
    total: all.length,
  });
});

historicoRouter.get('/export.csv', (req, res) => {
  const all = rows(req);
  const header = 'Data,Empresa,Investido,Retorno,Status';
  const lines = all.map((r) => [r.data, csvEscape(r.empresa), csvEscape(r.investidoFmt), csvEscape(r.retornoFmt), r.status].join(','));
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
