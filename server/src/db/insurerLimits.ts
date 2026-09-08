import { db } from './index.js';

// Capacidade que a seguradora DECLARA (migração 0071). Nada aqui é inferido: enquanto ela
// não declarar, os dois limites são null e a plataforma não impõe teto nenhum.
export interface InsurerLimitsRow {
  insurer_key: string;
  limite_total: number | null;
  limite_por_sacado: number | null;
  updated_at: string;
}

export function getInsurerLimits(insurerKey: string): InsurerLimitsRow | undefined {
  return db.prepare('SELECT * FROM insurer_limits WHERE insurer_key = ?').get(insurerKey) as InsurerLimitsRow | undefined;
}

export function listInsurerLimits(): InsurerLimitsRow[] {
  return db.prepare('SELECT * FROM insurer_limits ORDER BY insurer_key').all() as InsurerLimitsRow[];
}

/**
 * Grava a capacidade declarada. `null` em qualquer um dos dois significa "sem limite
 * declarado" — a seguradora pode voltar atrás e remover um teto que tinha informado, e o
 * efeito disso é deixar de haver enforcement naquela dimensão, não virar zero.
 */
export function setInsurerLimits(insurerKey: string, limiteTotal: number | null, limitePorSacado: number | null): InsurerLimitsRow {
  db.prepare(
    `INSERT INTO insurer_limits (insurer_key, limite_total, limite_por_sacado, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(insurer_key) DO UPDATE SET limite_total = excluded.limite_total,
                                            limite_por_sacado = excluded.limite_por_sacado,
                                            updated_at = excluded.updated_at`
  ).run(insurerKey, limiteTotal, limitePorSacado);
  return getInsurerLimits(insurerKey)!;
}
