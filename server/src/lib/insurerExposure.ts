import type { DuplicataRow } from '../db/types.js';
import { listInsuredByInsurerKey } from '../db/duplicatas.js';
import { getInsurerLimits } from '../db/insurerLimits.js';
import { fmtBRL } from './format.js';

// Exposição viva de uma seguradora: quanto do risco distribuído pela Lastro ainda pode
// virar sinistro. É a única visão que a plataforma tem legitimidade pra calcular — ela
// distribui as apólices, então enxerga o livro inteiro —, e é diferente de "total já
// segurado alguma vez", que era o único número existente e só cresce.
//
// O que NÃO está aqui, de propósito: resseguro. A retrocessão é contrato entre a
// seguradora e o ressegurador, e a Lastro não é parte dele (ver o item "Comissão de
// seguro" em data/seed.ts: distribuição, sem assumir risco de sinistro). Registrar aqui um
// contrato de que a plataforma não participa seria inventar um papel que ela não tem.

/**
 * Uma apólice sai da exposição quando o risco que ela cobre deixa de existir ou já foi
 * resolvido:
 * - `vendida`/`paga`: o cedente recebeu, que é exatamente o risco coberto;
 * - sinistro `aprovado` ou `negado`: já decidido, não é mais exposição em aberto.
 * O que sobra — inclusive sinistro 'aberto', que ainda pode ser pago — conta.
 */
export function apoliceEmRisco(d: DuplicataRow): boolean {
  if (d.status === 'vendida' || d.status === 'paga') return false;
  return d.sinistro_status === 'none' || d.sinistro_status === 'aberto';
}

/** Como um sacado é agrupado pra concentração: CNPJ quando existe, senão o nome. */
export function chaveDoSacado(d: DuplicataRow): string {
  return d.sacado_cnpj?.trim() ? d.sacado_cnpj.trim() : d.sacado_nome;
}

export interface ExposicaoPorSacado {
  chave: string;
  sacado: string;
  valor: number;
  valorFmt: string;
  apolices: number;
}

export interface ExposicaoSeguradora {
  insurerKey: string;
  total: number;
  totalFmt: string;
  apolices: number;
  limiteTotal: number | null;
  limiteTotalFmt: string | null;
  limitePorSacado: number | null;
  limitePorSacadoFmt: string | null;
  /** null quando não há limite declarado — não é 0%, é "não se aplica". */
  usoTotalPct: number | null;
  porSacado: ExposicaoPorSacado[];
}

export function buildExposicao(insurerKey: string, sandbox = false): ExposicaoSeguradora {
  const emRisco = listInsuredByInsurerKey(insurerKey, sandbox).filter(apoliceEmRisco);
  const limites = getInsurerLimits(insurerKey);

  const agrupado = new Map<string, ExposicaoPorSacado>();
  for (const d of emRisco) {
    const chave = chaveDoSacado(d);
    const atual = agrupado.get(chave) ?? { chave, sacado: d.sacado_nome, valor: 0, valorFmt: '', apolices: 0 };
    atual.valor += d.valor;
    atual.apolices += 1;
    agrupado.set(chave, atual);
  }
  const porSacado = [...agrupado.values()]
    .map((s) => ({ ...s, valorFmt: fmtBRL(s.valor) }))
    .sort((a, b) => b.valor - a.valor);

  const total = emRisco.reduce((soma, d) => soma + d.valor, 0);
  const limiteTotal = limites?.limite_total ?? null;
  const limitePorSacado = limites?.limite_por_sacado ?? null;

  return {
    insurerKey,
    total,
    totalFmt: fmtBRL(total),
    apolices: emRisco.length,
    limiteTotal,
    limiteTotalFmt: limiteTotal === null ? null : fmtBRL(limiteTotal),
    limitePorSacado,
    limitePorSacadoFmt: limitePorSacado === null ? null : fmtBRL(limitePorSacado),
    usoTotalPct: limiteTotal === null || limiteTotal <= 0 ? null : Math.round((total / limiteTotal) * 100),
    porSacado,
  };
}

export type CapacidadeMotivo = 'limite_total' | 'limite_por_sacado';

export interface CapacidadeVeredito {
  ok: boolean;
  motivo?: CapacidadeMotivo;
  message?: string;
}

/**
 * Esta seguradora ainda comporta MAIS esta duplicata? Verifica os dois tetos declarados
 * contra a exposição que já existe. Sem limite declarado, sempre cabe — a plataforma não
 * inventa uma capacidade que a seguradora nunca informou.
 *
 * A duplicata que já está segurada por esta mesma seguradora é descontada da base: trocar
 * de seguradora e voltar não pode contar o mesmo risco duas vezes.
 */
export function cabeNaCapacidade(insurerKey: string, d: DuplicataRow, sandbox = false): CapacidadeVeredito {
  const limites = getInsurerLimits(insurerKey);
  if (!limites || (limites.limite_total === null && limites.limite_por_sacado === null)) return { ok: true };

  const jaSegurada = d.insurer_key === insurerKey && apoliceEmRisco(d);
  const exposicao = buildExposicao(insurerKey, sandbox);
  const baseTotal = exposicao.total - (jaSegurada ? d.valor : 0);

  if (limites.limite_total !== null && baseTotal + d.valor > limites.limite_total) {
    return {
      ok: false,
      motivo: 'limite_total',
      message: `Capacidade esgotada nesta seguradora: ela declarou um limite de ${fmtBRL(limites.limite_total)} e já carrega ${fmtBRL(baseTotal)} em risco.`,
    };
  }

  if (limites.limite_por_sacado !== null) {
    const chave = chaveDoSacado(d);
    const doSacado = exposicao.porSacado.find((s) => s.chave === chave)?.valor ?? 0;
    const baseSacado = doSacado - (jaSegurada ? d.valor : 0);
    if (baseSacado + d.valor > limites.limite_por_sacado) {
      return {
        ok: false,
        motivo: 'limite_por_sacado',
        message: `Concentração no sacado ${d.sacado_nome} acima do que esta seguradora aceita: limite de ${fmtBRL(limites.limite_por_sacado)} por sacado, com ${fmtBRL(baseSacado)} já em risco.`,
      };
    }
  }

  return { ok: true };
}
