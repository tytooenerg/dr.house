import { db } from './index.js';

// Balcão (OTC) do secundário — migração 0072. SQL cru, como o resto de db/*.
export type OtcPapel = 'comprador' | 'vendedor';
export type OtcStatus = 'aberta' | 'aceita' | 'recusada' | 'cancelada' | 'expirada';

export interface OtcNegociacaoRow {
  id: number;
  purchase_id: number;
  duplicata_id: string;
  comprador_id: number;
  vendedor_id: number;
  valor: number;
  vez_de: OtcPapel;
  status: OtcStatus;
  expira_em: string;
  created_at: string;
}

export interface OtcRodadaRow {
  id: number;
  negociacao_id: number;
  autor_id: number;
  papel: OtcPapel;
  valor: number;
  nota: string | null;
  created_at: string;
}

export function createOtcNegociacao(input: {
  purchaseId: number;
  duplicataId: string;
  compradorId: number;
  vendedorId: number;
  valor: number;
  expiraEm: string;
  nota: string | null;
}): OtcNegociacaoRow {
  const info = db
    .prepare(
      `INSERT INTO otc_negociacoes (purchase_id, duplicata_id, comprador_id, vendedor_id, valor, vez_de, expira_em)
       VALUES (?, ?, ?, ?, ?, 'vendedor', ?)`
    )
    .run(input.purchaseId, input.duplicataId, input.compradorId, input.vendedorId, input.valor, input.expiraEm);
  const id = Number(info.lastInsertRowid);
  // A proposta de abertura é a primeira rodada: o histórico começa completo, sem um valor
  // inicial que não tem autor registrado.
  addOtcRodada(id, input.compradorId, 'comprador', input.valor, input.nota);
  return getOtcNegociacao(id)!;
}

export function getOtcNegociacao(id: number): OtcNegociacaoRow | undefined {
  return db.prepare('SELECT * FROM otc_negociacoes WHERE id = ?').get(id) as OtcNegociacaoRow | undefined;
}

/** Negociações abertas de uma posição — usado pra não deixar a mesma posição fechar duas vezes. */
export function listOtcAbertasByPurchase(purchaseId: number): OtcNegociacaoRow[] {
  return db.prepare("SELECT * FROM otc_negociacoes WHERE purchase_id = ? AND status = 'aberta'").all(purchaseId) as OtcNegociacaoRow[];
}

export function getOtcAbertaEntre(purchaseId: number, compradorId: number): OtcNegociacaoRow | undefined {
  return db
    .prepare("SELECT * FROM otc_negociacoes WHERE purchase_id = ? AND comprador_id = ? AND status = 'aberta'")
    .get(purchaseId, compradorId) as OtcNegociacaoRow | undefined;
}

/** Tudo que este usuário negocia, dos dois lados da mesa. Ninguém mais enxerga. */
export function listOtcDoUsuario(userId: number): OtcNegociacaoRow[] {
  return db
    .prepare('SELECT * FROM otc_negociacoes WHERE comprador_id = ? OR vendedor_id = ? ORDER BY id DESC')
    .all(userId, userId) as OtcNegociacaoRow[];
}

export function addOtcRodada(negociacaoId: number, autorId: number, papel: OtcPapel, valor: number, nota: string | null): OtcRodadaRow {
  const info = db
    .prepare('INSERT INTO otc_rodadas (negociacao_id, autor_id, papel, valor, nota) VALUES (?, ?, ?, ?, ?)')
    .run(negociacaoId, autorId, papel, valor, nota);
  return db.prepare('SELECT * FROM otc_rodadas WHERE id = ?').get(Number(info.lastInsertRowid)) as OtcRodadaRow;
}

export function listOtcRodadas(negociacaoId: number): OtcRodadaRow[] {
  return db.prepare('SELECT * FROM otc_rodadas WHERE negociacao_id = ? ORDER BY id').all(negociacaoId) as OtcRodadaRow[];
}

/** Nova contraproposta: troca o valor em cima da mesa e passa a vez pro outro lado. */
export function setOtcContraproposta(id: number, valor: number, vezDe: OtcPapel) {
  db.prepare('UPDATE otc_negociacoes SET valor = ?, vez_de = ? WHERE id = ?').run(valor, vezDe, id);
}

export function setOtcStatus(id: number, status: OtcStatus) {
  db.prepare('UPDATE otc_negociacoes SET status = ? WHERE id = ?').run(status, id);
}

/**
 * Marca como expirada toda negociação aberta cujo prazo passou. Chamada na leitura, e não
 * por um job: o prazo é o que impede uma proposta firme de virar uma opção eterna, então ele
 * tem que valer no momento em que alguém tenta agir sobre ela, não no próximo tick de um
 * timer.
 */
export function expireOtcVencidas(nowIso = new Date().toISOString()): number {
  return db.prepare("UPDATE otc_negociacoes SET status = 'expirada' WHERE status = 'aberta' AND expira_em <= ?").run(nowIso).changes;
}
