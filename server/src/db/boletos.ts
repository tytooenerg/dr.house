import { db } from './index.js';

export interface BoletoRow {
  nosso_numero: string;
  user_id: number;
  valor: number;
  status: 'ativo' | 'pago' | 'expirado';
  simulado: number;
  linha_digitavel: string | null;
  codigo_barras: string | null;
  pdf_url: string | null;
  created_at: string;
  paid_at: string | null;
}

export function createBoleto(opts: {
  nossoNumero: string;
  userId: number;
  valor: number;
  simulado: boolean;
  linhaDigitavel: string | null;
  codigoBarras: string | null;
  pdfUrl: string | null;
}) {
  db.prepare(
    'INSERT INTO boletos (nosso_numero, user_id, valor, simulado, linha_digitavel, codigo_barras, pdf_url) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(opts.nossoNumero, opts.userId, opts.valor, opts.simulado ? 1 : 0, opts.linhaDigitavel, opts.codigoBarras, opts.pdfUrl);
}

export function getBoleto(nossoNumero: string): BoletoRow | undefined {
  return db.prepare('SELECT * FROM boletos WHERE nosso_numero = ?').get(nossoNumero) as BoletoRow | undefined;
}

export function concludeBoleto(nossoNumero: string) {
  db.prepare("UPDATE boletos SET status = 'pago', paid_at = datetime('now') WHERE nosso_numero = ? AND status = 'ativo'").run(nossoNumero);
}

export function listBoletosByUser(userId: number): BoletoRow[] {
  return db.prepare('SELECT * FROM boletos WHERE user_id = ? ORDER BY created_at DESC').all(userId) as BoletoRow[];
}
