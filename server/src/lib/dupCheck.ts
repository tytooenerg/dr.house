import { db } from '../db/index.js';
import { fmtBRL } from './format.js';
import { checkDuplicidadeNaRegistradora, registradoraConfigured, type RegistradoraKey } from './registradoras.js';
import { logger } from './logger.js';
import type { DuplicataRow } from '../db/types.js';

export interface DupGroup {
  valorFmt: string;
  vencimento: string;
  ocorrencias: { id: string; cedenteNome: string; registradora: string | null }[];
  duplicidadeSuspeita: boolean;
  // null = no registradora configured for this group to check against; the UI must not
  // read that as "confirmed clean" — only a real registry response can say that.
  confirmadoNaRegistradora: boolean | null;
}

export interface DupCheckResult {
  queryType: 'cnpj' | 'id' | 'chave' | 'vazio';
  duplicidadeEncontrada: boolean;
  matches: DupGroup[];
}

// Real check against Lastro's own database — the same-amount-and-due-date pattern
// registered by more than one distinct cedente is the classic double-financing fraud
// this exists to catch. Additionally, for each match whose registradora has real API
// credentials configured (REGISTRADORA_*_API_URL/KEY — see lib/registradoras.ts), it also
// asks that registradora's own book directly instead of trusting Lastro's copy alone.
// Without any registradora configured, this still only guarantees no duplicidade within
// Lastro's own book — that limitation is now explicit per-match via confirmadoNaRegistradora
// instead of a blanket code comment.
export async function checkDuplicidade(query: string): Promise<DupCheckResult> {
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

  const matches: DupGroup[] = await Promise.all(
    [...groups.values()].map(async (group) => {
      const registradoraKey = group[0].registradora as RegistradoraKey | null;
      let confirmadoNaRegistradora: boolean | null = null;
      if (registradoraKey && registradoraConfigured(registradoraKey)) {
        try {
          const result = await checkDuplicidadeNaRegistradora(registradoraKey, group[0].sacado_cnpj, group[0].valor, group[0].vencimento);
          confirmadoNaRegistradora = result?.duplicidadeEncontrada ?? null;
        } catch (err) {
          logger.warn({ err, registradoraKey }, '[dupCheck] falha ao consultar duplicidade na registradora');
        }
      }
      return {
        valorFmt: fmtBRL(group[0].valor),
        vencimento: group[0].vencimento,
        ocorrencias: group.map((g) => ({ id: g.id, cedenteNome: g.cedente_nome, registradora: g.registradora })),
        duplicidadeSuspeita: new Set(group.map((g) => g.cedente_id)).size > 1 || confirmadoNaRegistradora === true,
        confirmadoNaRegistradora,
      };
    })
  );

  return { queryType, duplicidadeEncontrada: matches.some((m) => m.duplicidadeSuspeita), matches };
}
