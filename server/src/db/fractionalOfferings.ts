import { db } from './index.js';

export interface FractionalOfferingRow {
  id: number;
  duplicata_id: string;
  total_tokens: number;
  token_valor: number;
  tokens_vendidos: number;
  status: 'aberta' | 'concluida';
  created_at: string;
}

export function getOfferingByDuplicata(duplicataId: string): FractionalOfferingRow | undefined {
  return db.prepare('SELECT * FROM fractional_offerings WHERE duplicata_id = ?').get(duplicataId) as FractionalOfferingRow | undefined;
}

export function createOffering(duplicataId: string, totalTokens: number, tokenValor: number): FractionalOfferingRow {
  const info = db
    .prepare('INSERT INTO fractional_offerings (duplicata_id, total_tokens, token_valor) VALUES (?, ?, ?)')
    .run(duplicataId, totalTokens, tokenValor);
  return getOfferingByDuplicata(duplicataId) ?? (db.prepare('SELECT * FROM fractional_offerings WHERE id = ?').get(info.lastInsertRowid) as FractionalOfferingRow);
}

export function incrementTokensSold(offeringId: number, tokens: number): FractionalOfferingRow {
  db.prepare('UPDATE fractional_offerings SET tokens_vendidos = tokens_vendidos + ? WHERE id = ?').run(tokens, offeringId);
  return db.prepare('SELECT * FROM fractional_offerings WHERE id = ?').get(offeringId) as FractionalOfferingRow;
}

export function markOfferingComplete(offeringId: number) {
  db.prepare("UPDATE fractional_offerings SET status = 'concluida' WHERE id = ?").run(offeringId);
}

export interface FractionalHoldingRow {
  id: number;
  offering_id: number;
  investor_id: number;
  tokens: number;
  valor_investido: number;
  retorno: number;
  created_at: string;
}

export function createHolding(offeringId: number, investorId: number, tokens: number, valorInvestido: number, retorno: number): FractionalHoldingRow {
  const info = db
    .prepare('INSERT INTO fractional_holdings (offering_id, investor_id, tokens, valor_investido, retorno) VALUES (?, ?, ?, ?, ?)')
    .run(offeringId, investorId, tokens, valorInvestido, retorno);
  return db.prepare('SELECT * FROM fractional_holdings WHERE id = ?').get(info.lastInsertRowid) as FractionalHoldingRow;
}

export function listHoldingsForOffering(offeringId: number): FractionalHoldingRow[] {
  return db.prepare('SELECT * FROM fractional_holdings WHERE offering_id = ? ORDER BY created_at ASC').all(offeringId) as FractionalHoldingRow[];
}

export function listHoldingsByInvestor(
  investorId: number
): (FractionalHoldingRow & { duplicata_id: string; sacado_nome: string; total_tokens: number })[] {
  return db
    .prepare(
      `SELECT h.*, o.duplicata_id as duplicata_id, o.total_tokens as total_tokens, d.sacado_nome as sacado_nome
       FROM fractional_holdings h
       JOIN fractional_offerings o ON o.id = h.offering_id
       JOIN duplicatas d ON d.id = o.duplicata_id
       WHERE h.investor_id = ? ORDER BY h.created_at DESC`
    )
    .all(investorId) as (FractionalHoldingRow & { duplicata_id: string; sacado_nome: string; total_tokens: number })[];
}
