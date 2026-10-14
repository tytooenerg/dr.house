import { db } from './index.js';

// Leituras cruas dos indicadores de negócio do back-office (lib/businessMetrics.ts). Todas
// excluem duplicatas de sandbox e filtram por `created_at >= desde` comparando texto: o
// prefixo "YYYY-MM-DD" é igual nos três formatos de data gravados no banco (SQLite
// "YYYY-MM-DD HH:MM:SS", ISO com "T" e o now() do Postgres), então funciona nos dois drivers.
// O mês sai de substr(…, 1, 7) pelo mesmo motivo — nada de strftime/date_trunc.

export interface OperacaoRow {
  duplicata_id: string;
  primeira_compra: string;
  valor: number;
  cedente_id: number | null;
  vencimento: string;
}

// Só a PRIMEIRA compra de cada duplicata conta como operação: as seguintes são revenda no
// mercado secundário, que troca de dono um crédito já antecipado — não é volume novo.
export function listOperacoesDesde(desde: string): OperacaoRow[] {
  return db
    .prepare(
      `SELECT p.duplicata_id, MIN(p.created_at) AS primeira_compra, d.valor, d.cedente_id, d.vencimento
       FROM purchases p JOIN duplicatas d ON d.id = p.duplicata_id
       WHERE d.sandbox = 0
       GROUP BY p.duplicata_id, d.valor, d.cedente_id, d.vencimento
       HAVING MIN(p.created_at) >= ?`
    )
    .all(desde) as OperacaoRow[];
}

export function listCompradoresComLancePorMes(desde: string): { mes: string; bidder_id: number }[] {
  return db
    .prepare(
      `SELECT DISTINCT substr(b.created_at, 1, 7) AS mes, b.bidder_id
       FROM auction_bids b JOIN duplicatas d ON d.id = b.duplicata_id
       WHERE d.sandbox = 0 AND b.created_at >= ?`
    )
    .all(desde) as { mes: string; bidder_id: number }[];
}

// Um leilão que fecha sem lance devolve a duplicata ao cedente e não deixa rastro na própria
// duplicata (lib/auctionClose.ts) — o único registro dos dois desfechos é a trilha de auditoria.
export function countLeiloesEncerradosPorMes(desde: string): { mes: string; action: string; n: number }[] {
  return db
    .prepare(
      `SELECT substr(created_at, 1, 7) AS mes, action, COUNT(*) AS n
       FROM audit_log
       WHERE action IN ('leilao.adjudicado', 'leilao.encerrado_sem_lance') AND created_at >= ?
       GROUP BY substr(created_at, 1, 7), action`
    )
    .all(desde) as { mes: string; action: string; n: number }[];
}

export function listLancesVencedoresDesde(desde: string): { taxa_am: number; valor: number; leilao_fechado_em: string }[] {
  return db
    .prepare(
      `SELECT b.taxa_am, d.valor, d.leilao_fechado_em
       FROM auction_bids b JOIN duplicatas d ON d.id = b.duplicata_id
       WHERE b.status = 'vencedor' AND d.sandbox = 0 AND d.leilao_fechado_em >= ?`
    )
    .all(desde) as { taxa_am: number; valor: number; leilao_fechado_em: string }[];
}

export function sumReceitaPorMes(desde: string): { mes: string; receita: number }[] {
  return db
    .prepare(
      `SELECT substr(f.created_at, 1, 7) AS mes, SUM(f.fee_valor) AS receita
       FROM platform_fee_events f JOIN duplicatas d ON d.id = f.duplicata_id
       WHERE d.sandbox = 0 AND f.created_at >= ?
       GROUP BY substr(f.created_at, 1, 7)`
    )
    .all(desde) as { mes: string; receita: number }[];
}

// Carteira viva: vendida e ainda não paga. Fotografia de agora, não série mensal.
export function listCarteiraEmAberto(): { valor: number; vencimento: string }[] {
  return db.prepare("SELECT valor, vencimento FROM duplicatas WHERE sandbox = 0 AND status = 'vendida'").all() as { valor: number; vencimento: string }[];
}

export function countSinistrosAbertos(): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM duplicatas WHERE sandbox = 0 AND sinistro_status = 'aberto'").get() as { n: number }).n;
}
