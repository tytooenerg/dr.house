import { db } from './index.js';

export interface AceiteConviteRow {
  id: number;
  aceite_id: number;
  token_hash: string;
  email: string | null;
  telefone: string | null;
  criado_por: number;
  usado_em: string | null;
  decisao: 'aceita' | 'contestada' | null;
  respondido_por_nome: string | null;
  respondido_por_cargo: string | null;
  respondido_ip: string | null;
  respondido_user_agent: string | null;
  created_at: string;
}

export function createAceiteConvite(input: { aceiteId: number; tokenHash: string; email: string | null; telefone: string | null; criadoPor: number }): AceiteConviteRow {
  const info = db
    .prepare('INSERT INTO aceite_convites (aceite_id, token_hash, email, telefone, criado_por) VALUES (?, ?, ?, ?, ?)')
    .run(input.aceiteId, input.tokenHash, input.email, input.telefone, input.criadoPor);
  return db.prepare('SELECT * FROM aceite_convites WHERE id = ?').get(Number(info.lastInsertRowid)) as AceiteConviteRow;
}

export function getAceiteConviteByHash(tokenHash: string): AceiteConviteRow | undefined {
  return db.prepare('SELECT * FROM aceite_convites WHERE token_hash = ?').get(tokenHash) as AceiteConviteRow | undefined;
}

export function getUltimoConvite(aceiteId: number): AceiteConviteRow | undefined {
  return db.prepare('SELECT * FROM aceite_convites WHERE aceite_id = ? ORDER BY id DESC LIMIT 1').get(aceiteId) as AceiteConviteRow | undefined;
}

/** Marca o convite como usado — só se ainda não foi (devolve false numa corrida de dois cliques). */
export function marcarConviteUsado(
  id: number,
  r: { decisao: 'aceita' | 'contestada'; nome: string; cargo: string; ip: string | null; userAgent: string | null }
): boolean {
  const info = db
    .prepare(
      `UPDATE aceite_convites SET usado_em = datetime('now'), decisao = ?, respondido_por_nome = ?, respondido_por_cargo = ?, respondido_ip = ?, respondido_user_agent = ?
       WHERE id = ? AND usado_em IS NULL`
    )
    .run(r.decisao, r.nome, r.cargo, r.ip, r.userAgent, id);
  return info.changes === 1;
}
