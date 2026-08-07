import { db } from './index.js';
import type { DuplicataRow } from './types.js';
import { SACADOS } from '../data/seed.js';
import { parseFlexibleDate } from '../lib/format.js';

export function getDuplicata(id: string): DuplicataRow | undefined {
  return db.prepare('SELECT * FROM duplicatas WHERE id = ?').get(id) as DuplicataRow | undefined;
}

// Live/internal reads (SPA, background jobs, revenue, compliance) only ever see real
// data — sandbox=1 rows created via a test-mode partner API key (lib/sandboxData.ts) are
// filtered out here, at the query layer, so no caller can accidentally leak them into a
// real list just by forgetting to check a flag.
export function listByCedente(cedenteId: number): DuplicataRow[] {
  return db.prepare('SELECT * FROM duplicatas WHERE cedente_id = ? AND sandbox = 0 ORDER BY created_at DESC').all(cedenteId) as DuplicataRow[];
}

export function countByCedenteThisMonth(cedenteId: number): number {
  const row = db
    .prepare("SELECT COUNT(*) as n FROM duplicatas WHERE cedente_id = ? AND sandbox = 0 AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')")
    .get(cedenteId) as { n: number };
  return row.n;
}

export function listMarketplace(sandbox = false): DuplicataRow[] {
  // Include 'vendida' too: a bought offer should still render (as "Comprada") in the
  // marketplace list rather than disappearing the instant someone buys it.
  return db
    .prepare("SELECT * FROM duplicatas WHERE status IN ('no_mercado', 'vendida') AND sandbox = ? ORDER BY created_at DESC")
    .all(sandbox ? 1 : 0) as DuplicataRow[];
}

export function listBySacadoNome(sacadoNome: string): DuplicataRow[] {
  return db
    .prepare('SELECT * FROM duplicatas WHERE lower(sacado_nome) = lower(?) AND sandbox = 0 ORDER BY created_at DESC')
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
  registradora?: string | null;
  nfeChave?: string | null;
  id?: string;
  sandbox?: boolean;
}): DuplicataRow {
  const id = input.id ?? nextId('DUP-2026');
  db.prepare(
    `INSERT INTO duplicatas (id, cedente_id, cedente_nome, sacado_nome, sacado_cnpj, valor, vencimento, emissao, status, lastro_pct, seguro, registro, desagio, score, registradora, nfe_chave, sandbox)
     VALUES (@id, @cedenteId, @cedenteNome, @sacadoNome, @sacadoCnpj, @valor, @vencimento, @emissao, @status, @lastroPct, @seguro, @registro, @desagio, @score, @registradora, @nfeChave, @sandbox)`
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
    registradora: input.registradora ?? null,
    nfeChave: input.nfeChave || null,
    sandbox: input.sandbox ? 1 : 0,
  });
  return getDuplicata(id)!;
}

export function findDuplicataByNfeChave(chave: string): DuplicataRow | undefined {
  return db.prepare('SELECT * FROM duplicatas WHERE nfe_chave = ?').get(chave) as DuplicataRow | undefined;
}

// Baseline for anomaly detection: average valor of this sacado's prior duplicatas,
// excluding the brand-new one being evaluated. Requires a minimal history to be
// meaningful — a single prior data point isn't a real baseline.
export function sacadoValorStats(sacadoCnpj: string): { avg: number; n: number } {
  const row = db
    .prepare("SELECT AVG(valor) as avg, COUNT(*) as n FROM duplicatas WHERE sacado_cnpj = ? AND sacado_cnpj != ''")
    .get(sacadoCnpj) as { avg: number | null; n: number };
  return { avg: row.avg ?? 0, n: row.n };
}

export function setStatus(id: string, status: string) {
  db.prepare('UPDATE duplicatas SET status = ? WHERE id = ?').run(status, id);
}

export function setComplianceScore(id: string, score: number) {
  db.prepare('UPDATE duplicatas SET compliance_score = ? WHERE id = ?').run(score, id);
}

export function dispararLeilao(id: string, closeAtIso: string) {
  db.prepare("UPDATE duplicatas SET status = 'no_mercado', close_at = ?, leilao_started_at = ? WHERE id = ?").run(closeAtIso, new Date().toISOString(), id);
}

export function setInsurer(id: string, insurerKey: string | null) {
  db.prepare('UPDATE duplicatas SET insurer_key = ? WHERE id = ?').run(insurerKey, id);
}

export function listInsuredByInsurerKey(insurerKey: string): DuplicataRow[] {
  return db.prepare('SELECT * FROM duplicatas WHERE insurer_key = ? AND sandbox = 0 ORDER BY created_at DESC').all(insurerKey) as DuplicataRow[];
}

// A policy becomes claimable once its vencimento has passed and it was never sold —
// i.e. the cedente never got paid by the market, which is exactly what the insurance covers.
export function listClaimableByInsurerKey(insurerKey: string): DuplicataRow[] {
  const now = Date.now();
  return db
    .prepare("SELECT * FROM duplicatas WHERE insurer_key = ? AND sandbox = 0 AND sinistro_status = 'none' AND status != 'vendida'")
    .all(insurerKey)
    .filter((d) => parseFlexibleDate((d as DuplicataRow).vencimento).getTime() < now) as DuplicataRow[];
}

export function setSinistroStatus(id: string, status: 'aberto' | 'aprovado' | 'negado', note: string) {
  db.prepare('UPDATE duplicatas SET sinistro_status = ?, sinistro_note = ? WHERE id = ?').run(status, note, id);
}

// Candidates for cobrança jurídica (lib/legalCollection.ts) — vencimento already passed
// and the duplicata is still a live position (not rejected/suspended/pending-analysis).
// Final eligibility (aceite confirmado, sem disputa aberta) is checked per-item by
// checkCollectionEligibility, same JS-filter pattern as listClaimableByInsurerKey.
export function listOverdueDuplicatas(): DuplicataRow[] {
  const now = Date.now();
  return (db.prepare("SELECT * FROM duplicatas WHERE status IN ('aprovada', 'vendida') AND sandbox = 0").all() as DuplicataRow[]).filter(
    (d) => parseFlexibleDate(d.vencimento).getTime() < now
  );
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
  com_regresso: number;
  created_at: string;
}

export function listPurchasesByInvestor(
  investorId: number
): (PurchaseRow & { sacado_nome: string; score: number | null; seguro: number })[] {
  return db
    .prepare(
      `SELECT p.*, d.sacado_nome as sacado_nome, d.score as score, d.seguro as seguro FROM purchases p
       JOIN duplicatas d ON d.id = p.duplicata_id
       WHERE p.investor_id = ? ORDER BY p.created_at DESC`
    )
    .all(investorId) as (PurchaseRow & { sacado_nome: string; score: number | null; seguro: number })[];
}
