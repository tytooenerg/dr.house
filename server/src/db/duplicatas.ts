import { db } from './index.js';
import type { DuplicataRow } from './types.js';
import { SACADOS } from '../data/seed.js';
import { parseFlexibleDate } from '../lib/format.js';
import { sectorFor } from '../lib/riscoCore.js';

export function getDuplicata(id: string): DuplicataRow | undefined {
  return db.prepare('SELECT * FROM duplicatas WHERE id = ?').get(id) as DuplicataRow | undefined;
}

// One-time backfill for duplicatas created before the `setor` column existed (migration
// 0060) — a plain `ALTER TABLE ADD COLUMN` doesn't retroactively compute a value, so every
// duplicata emitted before this feature shipped (including anything already seeded on a
// dev/demo database from before the merge) would otherwise show no class badge on the
// Marketplace forever, even though the same sectorFor lookup that new duplicatas use at
// emission time can classify it just fine. Idempotent and cheap — only touches rows still
// NULL, safe to run on every boot (server/src/index.ts calls it once after seedIfEmpty()).
export function backfillDuplicataSetor(): number {
  const rows = db.prepare('SELECT id, sacado_nome FROM duplicatas WHERE setor IS NULL').all() as { id: string; sacado_nome: string }[];
  if (rows.length === 0) return 0;
  const update = db.prepare('UPDATE duplicatas SET setor = ? WHERE id = ?');
  let updated = 0;
  for (const row of rows) {
    const setor = sectorFor(row.sacado_nome);
    if (setor) {
      update.run(setor, row.id);
      updated++;
    }
  }
  return updated;
}

// Live/internal reads (SPA, background jobs, revenue, compliance) only ever see real
// data — sandbox=1 rows created via a test-mode partner API key (lib/sandboxData.ts) are
// filtered out here, at the query layer, so no caller can accidentally leak them into a
// real list just by forgetting to check a flag.
export function listByCedente(cedenteId: number): DuplicataRow[] {
  return db.prepare('SELECT * FROM duplicatas WHERE cedente_id = ? AND sandbox = 0 ORDER BY created_at DESC').all(cedenteId) as DuplicataRow[];
}

// Feature "AI CFO — DRE simplificado (Empresarial)": revenue the cedente actually received
// via Lastro in a period — a duplicata only counts once an investor's purchase actually
// settled it (purchases.created_at), not when it was merely emitted/listed. Face value
// (d.valor), not netted for Lastro's platform fee/deságio — see lib/cashflowForecast.ts
// for why this DRE is explicitly labeled "simplificado" rather than a real accounting DRE.
export function listSettledByCedenteSince(cedenteId: number, sinceIso: string): { valor: number; settledAt: string }[] {
  return db
    .prepare(
      `SELECT d.valor as valor, p.created_at as settledAt FROM purchases p
       JOIN duplicatas d ON d.id = p.duplicata_id
       WHERE d.cedente_id = ? AND d.sandbox = 0 AND p.created_at >= ?`
    )
    .all(cedenteId, sinceIso) as { valor: number; settledAt: string }[];
}

// Training set for lib/mlScoring.ts — every real (non-sandbox) duplicata, regardless of
// status, so the trainer can derive whatever label it needs from real state transitions
// (sinistro_status, status='paga' via legal recovery) rather than a curated subset.
export function listAllDuplicatasForTraining(): DuplicataRow[] {
  return db.prepare('SELECT * FROM duplicatas WHERE sandbox = 0').all() as DuplicataRow[];
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
    `INSERT INTO duplicatas (id, cedente_id, cedente_nome, sacado_nome, sacado_cnpj, valor, vencimento, emissao, status, lastro_pct, seguro, registro, desagio, score, setor, registradora, nfe_chave, sandbox)
     VALUES (@id, @cedenteId, @cedenteNome, @sacadoNome, @sacadoCnpj, @valor, @vencimento, @emissao, @status, @lastroPct, @seguro, @registro, @desagio, @score, @setor, @registradora, @nfeChave, @sandbox)`
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
    setor: sectorFor(input.sacadoNome),
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

// `sandbox` follows the same live/test data-plane split db/aceites.ts and db/disputes.ts
// already use: the internal SPA never passes it (always sandbox=0, real data only); the v1
// partner API's seguradora endpoints pass `req.apiKey!.mode === 'test'` so a test-mode
// seguradora key only ever sees/decides sandbox sinistros, never a real one (and vice
// versa) — previously hardcoded to sandbox=0 regardless of caller, a real isolation gap for
// a partner-facing decision endpoint (see README "Known gaps").
export function listInsuredByInsurerKey(insurerKey: string, sandbox = false): DuplicataRow[] {
  return db
    .prepare('SELECT * FROM duplicatas WHERE insurer_key = ? AND sandbox = ? ORDER BY created_at DESC')
    .all(insurerKey, sandbox ? 1 : 0) as DuplicataRow[];
}

// A policy becomes claimable once its vencimento has passed and it was never sold —
// i.e. the cedente never got paid by the market, which is exactly what the insurance covers.
export function listClaimableByInsurerKey(insurerKey: string, sandbox = false): DuplicataRow[] {
  const now = Date.now();
  return db
    .prepare("SELECT * FROM duplicatas WHERE insurer_key = ? AND sandbox = ? AND sinistro_status = 'none' AND status != 'vendida'")
    .all(insurerKey, sandbox ? 1 : 0)
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

// A duplicata counts as "purchased" (unavailable for a fresh whole purchase) either the
// normal way — a row in `purchases` — or because a fractional offering exists for it at
// all (lib/fractionalOfferings.ts), open or completed: once tokens are being sold to
// multiple investors, the whole receivable can never also be sold whole to someone else,
// same as it can't be double-sold whole to two different investors. Every existing caller
// already only ever used this as "can this still be bought" — extending, not narrowing,
// what it means to be unavailable is safe for every pre-existing call site.
export function isPurchased(duplicataId: string): boolean {
  const row = db.prepare('SELECT COUNT(*) as n FROM purchases WHERE duplicata_id = ?').get(duplicataId) as { n: number };
  if (row.n > 0) return true;
  const offering = db.prepare('SELECT COUNT(*) as n FROM fractional_offerings WHERE duplicata_id = ?').get(duplicataId) as { n: number };
  return offering.n > 0;
}

// `retorno` is the real, deterministic gain this specific purchase captured — face value
// minus what was actually paid for it (lib/marketCompute.ts's computePurchasePrice on a
// primary buy, or the agreed price vs. face value on a mercado secundário resale — see
// lib/resaleCore.ts's executeResaleTrade). Every caller must compute its own real number;
// this used to default to Math.round(valor * (0.02 + Math.random() * 0.02)) — a fabricated
// number with no connection to any real deságio, feeding Carteira & Histórico's "Retorno"
// column, its "Retorno acumulado" headline, the whole Performance institucional dashboard
// (lib/investorPerformance.ts) and the institutional PDF report as if it were real.
export function createPurchase(duplicataId: string, investorId: number, valor: number, taxa: string, retorno: number) {
  db.prepare('INSERT INTO purchases (duplicata_id, investor_id, valor, taxa, retorno) VALUES (?, ?, ?, ?, ?)').run(duplicataId, investorId, valor, taxa, retorno);
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
): (PurchaseRow & { sacado_nome: string; score: number | null; seguro: number; vencimento: string })[] {
  return db
    .prepare(
      `SELECT p.*, d.sacado_nome as sacado_nome, d.score as score, d.seguro as seguro, d.vencimento as vencimento FROM purchases p
       JOIN duplicatas d ON d.id = p.duplicata_id
       WHERE p.investor_id = ? ORDER BY p.created_at DESC`
    )
    .all(investorId) as (PurchaseRow & { sacado_nome: string; score: number | null; seguro: number; vencimento: string })[];
}

// Face value of every position this investor still actually holds — an active purchase
// (never resold) whose duplicata hasn't been paid off yet (see lib/settlement.ts's
// settleAtMaturity). Generic utility, not Confirming-specific: reused by
// lib/confirmingFundo.ts's computeFundoNav the same way lib/creditLineFund.ts's
// computeFundNav sums outstanding draws — cash on hand alone understates a fund's real NAV
// while it still holds unpaid positions.
export function sumOutstandingPurchasesByInvestor(investorId: number): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(p.valor), 0) as total FROM purchases p
       JOIN duplicatas d ON d.id = p.duplicata_id
       WHERE p.investor_id = ? AND p.active = 1 AND d.status != 'paga'`
    )
    .get(investorId) as { total: number };
  return row.total;
}
