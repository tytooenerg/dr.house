import { db } from '../db/index.js';
import { fmtBRL } from './format.js';
import type { DuplicataRow } from '../db/types.js';

export interface DupGroup {
  valorFmt: string;
  vencimento: string;
  ocorrencias: { id: string; cedenteNome: string; registradora: string | null }[];
  duplicidadeSuspeita: boolean;
}

export interface DupCheckResult {
  queryType: 'cnpj' | 'id' | 'chave' | 'vazio';
  duplicidadeEncontrada: boolean;
  matches: DupGroup[];
}

// Real check against Lastro's own database — the same-amount-and-due-date pattern
// registered by more than one distinct cedente is the classic double-financing fraud
// this exists to catch. This does NOT reach CERC/B3/Núclea's own registries directly
// (that requires the real registry API integration tracked as a known gap); it only
// guarantees no duplicidade within Lastro's own book.
export function checkDuplicidade(query: string): DupCheckResult {
  const trimmed = query.trim();
  if (!trimmed) return { queryType: 'vazio', duplicidadeEncontrada: false, matches: [] };

  const digits = trimmed.replace(/\D/g, '');
  let rows: DuplicataRow[];
  let queryType: DupCheckResult['queryType'];

  if (digits.length === 44) {
    queryType = 'chave';
    rows = db.prepare('SELECT * FROM duplicatas WHERE nfe_chave = ?').all(digits) as DuplicataRow[];
  } else if (digits.length >= 11) {
    queryType = 'cnpj';
    // sacado_cnpj is stored exactly as the cedente typed it (with or without
    // punctuation), so normalize both sides to digits-only before comparing.
    rows = db
      .prepare(
        `SELECT * FROM duplicatas
         WHERE REPLACE(REPLACE(REPLACE(sacado_cnpj, '.', ''), '-', ''), '/', '') = ?`
      )
      .all(digits) as DuplicataRow[];
  } else {
    queryType = 'id';
    rows = db.prepare('SELECT * FROM duplicatas WHERE id = ?').all(trimmed) as DuplicataRow[];
  }

  const groups = new Map<string, DuplicataRow[]>();
  for (const r of rows) {
    const key = `${r.valor}|${r.vencimento}`;
    const arr = groups.get(key) ?? [];
    arr.push(r);
    groups.set(key, arr);
  }

  const matches: DupGroup[] = [...groups.values()].map((group) => ({
    valorFmt: fmtBRL(group[0].valor),
    vencimento: group[0].vencimento,
    ocorrencias: group.map((g) => ({ id: g.id, cedenteNome: g.cedente_nome, registradora: g.registradora })),
    duplicidadeSuspeita: new Set(group.map((g) => g.cedente_id)).size > 1,
  }));

  return { queryType, duplicidadeEncontrada: matches.some((m) => m.duplicidadeSuspeita), matches };
}
