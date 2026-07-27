import { db } from './index.js';
import type { DuplicataRow } from './types.js';
import { SACADOS } from '../data/seed.js';
import { parseFlexibleDate } from '../lib/format.js';

export function getDuplicata(id: string): DuplicataRow | undefined {
  return db.prepare('SELECT * FROM duplicatas WHERE id = ?').get(id) as DuplicataRow | undefined;
}

export function listByCedente(cedenteId: number): DuplicataRow[] {
  return db.prepare('SELECT * FROM duplicatas WHERE cedente_id = ? ORDER BY created_at DESC').all(cedenteId) as DuplicataRow[];
}

export function countByCedenteThisMonth(cedenteId: number): number {
  const row = db
    .prepare("SELECT COUNT(*) as n FROM duplicatas WHERE cedente_id = ? AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')")
    .get(cedenteId) as { n: number };
  return row.n;
}

export function listMarketplace(): DuplicataRow[] {
  // Include 'vendida' too: a bought offer should still render (as "Comprada") in the
  // marketplace list rather than disappearing the instant someone buys it.
  return db.prepare("SELECT * FROM duplicatas WHERE status IN ('no_mercado', 'vendida') ORDER BY created_at DESC").all() as DuplicataRow[];
}

export function listBySacadoNome(sacadoNome: string): DuplicataRow[] {
  return db
    .prepare('SELECT * FROM duplicatas WHERE lower(sacado_nome) = lower(?) ORDER BY created_at DESC')
    .all(sacadoNome) as DuplicataRow[];
}

function scoreFor(sacadoNome: string): number | null {
  const s = SACADOS[sacadoNome];
  return s ? s.score : null;
}

function nextId(prefix: string): string {
  const row = db.prepare('SELECT COUNT(*) as n FROM duplicatas').get() as { n: number };
  return `${prefix}-${1000 + row.n}-${Math.random().toString(16).slice(2, 6)}`;
}

export function createDuplicata(input: {
  cedenteId: number | null;
  cedenteNome: string;
  sacadoNome: string;
  sacadoCnpj: string;
  valor: number;
  vencimento: string;
  emissao: string;
  status: string;
  lastroPct: number;
  seguro: boolean;
  registro?: string | null;
  desagio?: string | null;
  id?: string;
}): DuplicataRow {
  const id = input.id ?? nextId('DUP-2026');
  db.prepare(
    `INSERT INTO duplicatas (id, cedente_id, cedente_nome, sacado_nome, sacado_cnpj, valor, vencimento, emissao, status, lastro_pct, seguro, registro, desagio, score)
     VALUES (@id, @cedenteId, @cedenteNome, @sacadoNome, @sacadoCnpj, @valor, @vencimento, @emissao, @status, @lastroPct, @seguro, @registro, @desagio, @score)`
  ).run({
    id,
    cedenteId: input.cedenteId,
    cedenteNome: input.cedenteNome,
    sacadoNome: input.sacadoNome,
    sacadoCnpj: input.sacadoCnpj,
    valor: input.valor,
    vencimento: input.vencimento,
    emissao: input.emissao,
    status: input.status,
    lastroPct: input.lastroPct,
    seguro: input.seguro ? 1 : 0,
    registro: input.registro ?? null,
    desagio: input.desagio ?? null,
    score: scoreFor(input.sacadoNome),
  });
  return getDuplicata(id)!;
}

export function setStatus(id: string, status: string) {
  db.prepare('UPDATE duplicatas SET status = ? WHERE id = ?').run(status, id);
}

export function dispararLeilao(id: string, closeAtIso: string) {
  db.prepare("UPDATE duplicatas SET status = 'no_mercado', close_at = ?, leilao_started_at = ? WHERE id = ?").run(closeAtIso, new Date().toISOString(), id);
}

export function setInsurer(id: string, insurerKey: string | null) {
  db.prepare('UPDATE duplicatas SET insurer_key = ? WHERE id = ?').run(insurerKey, id);
}

export function listInsuredByInsurerKey(insurerKey: string): DuplicataRow[] {
  return db.prepare('SELECT * FROM duplicatas WHERE insurer_key = ? ORDER BY created_at DESC').all(insurerKey) as DuplicataRow[];
}

// A policy becomes claimable once its vencimento has passed and it was never sold —
// i.e. the cedente never got paid by the market, which is exactly what the insurance covers.
export function listClaimableByInsurerKey(insurerKey: string): DuplicataRow[] {
  const now = Date.now();
  return db
    .prepare("SELECT * FROM duplicatas WHERE insurer_key = ? AND sinistro_status = 'none' AND status != 'vendida'")
    .all(insurerKey)
    .filter((d) => parseFlexibleDate((d as DuplicataRow).vencimento).getTime() < now) as DuplicataRow[];
}

export function setSinistroStatus(id: string, status: 'aberto' | 'aprovado' | 'negado', note: string) {
  db.prepare('UPDATE duplicatas SET sinistro_status = ?, sinistro_note = ? WHERE id = ?').run(status, note, id);
}

export function isPurchased(duplicataId: string): boolean {
  const row = db.prepare('SELECT COUNT(*) as n FROM purchases WHERE duplicata_id = ?').get(duplicataId) as { n: number };
  return row.n > 0;
}

export function createPurchase(duplicataId: string, investorId: number, valor: number, taxa: string) {
  db.prepare('INSERT INTO purchases (duplicata_id, investor_id, valor, taxa, retorno) VALUES (?, ?, ?, ?, ?)').run(
    duplicataId,
    investorId,
    valor,
    taxa,
    Math.round(valor * (0.02 + Math.random() * 0.02))
  );
  setStatus(duplicataId, 'vendida');
}

export interface PurchaseRow {
  id: number;
  duplicata_id: string;
  investor_id: number;
  valor: number;
  taxa: string;
  retorno: number;
  active: number;
  created_at: string;
}

export function listPurchasesByInvestor(investorId: number): (PurchaseRow & { sacado_nome: string })[] {
  return db
    .prepare(
      `SELECT p.*, d.sacado_nome as sacado_nome FROM purchases p
       JOIN duplicatas d ON d.id = p.duplicata_id
       WHERE p.investor_id = ? ORDER BY p.created_at DESC`
    )
    .all(investorId) as (PurchaseRow & { sacado_nome: string })[];
}
