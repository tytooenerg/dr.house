import { db } from '../db/index.js';
import { fmtBRL } from './format.js';
import { getRegistradora } from './registradoras.js';
import { getFundBalance } from '../db/guaranteeFund.js';

// Real aggregates computed live from the database — no fabricated numbers. On a fresh
// deployment these will be small (or zero); they grow as real usage grows, exactly like
// any transparency page should.
export function buildPublicStats() {
  const volumeEmitido = (db.prepare('SELECT COALESCE(SUM(valor), 0) as v FROM duplicatas').get() as { v: number }).v;
  const volumeFinanciado = (db.prepare('SELECT COALESCE(SUM(valor), 0) as v FROM purchases').get() as { v: number }).v;
  const totalDuplicatas = (db.prepare('SELECT COUNT(*) as n FROM duplicatas').get() as { n: number }).n;
  const totalCedentes = (db.prepare("SELECT COUNT(*) as n FROM users WHERE role = 'cedente'").get() as { n: number }).n;
  const totalInvestidores = (db.prepare("SELECT COUNT(*) as n FROM users WHERE role = 'investidor'").get() as { n: number }).n;
  const totalSacadosDistintos = (db.prepare('SELECT COUNT(DISTINCT sacado_nome) as n FROM duplicatas').get() as { n: number }).n;

  const vencidas = (db.prepare("SELECT COUNT(*) as n FROM duplicatas WHERE date(vencimento) < date('now')").get() as { n: number }).n;
  const inadimplentes = (
    db.prepare("SELECT COUNT(*) as n FROM duplicatas WHERE date(vencimento) < date('now') AND status != 'vendida'").get() as { n: number }
  ).n;
  const taxaInadimplenciaPct = vencidas > 0 ? +((inadimplentes / vencidas) * 100).toFixed(1) : 0;

  const avgLiquidacao = db
    .prepare(
      `SELECT AVG(julianday(p.created_at) - julianday(d.created_at)) as dias
       FROM purchases p JOIN duplicatas d ON d.id = p.duplicata_id`
    )
    .get() as { dias: number | null };
  const tempoMedioLiquidacaoHoras = avgLiquidacao.dias != null ? Math.max(0, Math.round(avgLiquidacao.dias * 24)) : null;

  const porRegistradora = db
    .prepare("SELECT registradora, COUNT(*) as n FROM duplicatas WHERE registradora IS NOT NULL GROUP BY registradora")
    .all() as { registradora: string; n: number }[];
  const registradoras = porRegistradora.map((r) => ({
    key: r.registradora,
    nome: getRegistradora(r.registradora)?.name ?? r.registradora,
    totalDuplicatas: r.n,
  }));

  return {
    registradoras,
    volumeEmitidoFmt: fmtBRL(volumeEmitido),
    volumeFinanciadoFmt: fmtBRL(volumeFinanciado),
    totalDuplicatas,
    totalCedentes,
    totalInvestidores,
    totalSacadosDistintos,
    taxaInadimplenciaPct,
    tempoMedioLiquidacaoHoras,
    // Real balance of the guarantee fund (lib/guaranteeFund.ts) — a transparency
    // number, same spirit as everything else on this page: no fabricated marketing figure.
    fundoGarantiaFmt: fmtBRL(getFundBalance()),
    geradoEm: new Date().toISOString(),
  };
}
