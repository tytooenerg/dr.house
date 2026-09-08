import { INSURERS } from '../data/seed.js';
import { parseFlexibleDate } from './format.js';
import type { DuplicataRow } from '../db/types.js';
import { cabeNaCapacidade } from './insurerExposure.js';

// Real competing insurance quotes — until now every insurer quoted the exact same flat
// premioPct for every duplicata regardless of risk, which isn't how underwriting actually
// works and meant "compare seguradoras" in the UI was cosmetic (the numbers never moved).
// Each insurer here has its own deterministic, documented pricing formula driven by real
// attributes of the specific duplicata (score, valor, days to maturity) — same "every
// number traces to a rule, no black box" discipline as the rest of this codebase. The
// insurers genuinely disagree on price depending on the risk profile, which is what makes
// this a real comparison instead of 3 rows that always show the same number in a
// different order.

const PREMIO_FLOOR_PCT = 0.3;
const PREMIO_CEIL_PCT = 0.9;

function clampPremio(pct: number): number {
  return Math.max(PREMIO_FLOOR_PCT, Math.min(PREMIO_CEIL_PCT, pct));
}

export function diasAteVencimento(vencimento: string): number {
  const ms = parseFlexibleDate(vencimento).getTime() - Date.now();
  return Math.round(ms / (24 * 3600 * 1000));
}

// Too Seguros ("Parceira desde 2024") specializes in low-risk paper: tightens its price
// as the sacado's score climbs above the platform-neutral 50, widens it for weaker scores.
function tooQuote(score: number): number {
  return clampPremio(0.55 - (score - 50) * 0.003);
}

// Pottencial ("Maior cobertura de sinistro") prices flat regardless of score — its edge is
// coverage breadth, not risk selection — but adds a small large-ticket surcharge, since a
// single big claim concentrates more of its exposure.
function pottencialQuote(valor: number): number {
  return clampPremio(0.6 + (valor > 100000 ? 0.05 : 0));
}

// Junto Seguros ("Aprovação mais rápida") is built around fast turnaround on
// near-term paper — it discounts duplicatas maturing soon (less time for something to go
// wrong before it pays out) and holds its base rate otherwise.
function juntoQuote(diasVencimento: number): number {
  return clampPremio(0.68 - (diasVencimento >= 0 && diasVencimento < 30 ? 0.1 : 0));
}

export interface InsuranceQuote {
  key: string;
  name: string;
  premioPct: number;
  premioFmt: string;
  selo: string;
  recommended: boolean;
}

export function computeInsurerQuotePct(insurerKey: string, d: Pick<DuplicataRow, 'score' | 'valor' | 'vencimento'>): number {
  const score = d.score ?? 60;
  switch (insurerKey) {
    case 'too':
      return tooQuote(score);
    case 'pottencial':
      return pottencialQuote(d.valor);
    case 'junto':
      return juntoQuote(diasAteVencimento(d.vencimento));
    default:
      return INSURERS.find((i) => i.key === insurerKey)?.premioPct ?? 0.6;
  }
}

export function listInsuranceQuotes(d: Pick<DuplicataRow, 'score' | 'valor' | 'vencimento'>): InsuranceQuote[] {
  const quotes = INSURERS.map((ins) => {
    const premioPct = computeInsurerQuotePct(ins.key, d);
    return { key: ins.key, name: ins.name, premioPct, premioFmt: premioPct.toFixed(2).replace('.', ',') + '%', selo: ins.selo };
  }).sort((a, b) => a.premioPct - b.premioPct);
  return quotes.map((q, i) => ({ ...q, recommended: i === 0 }));
}

// A mesma cotação, anotada com a capacidade declarada de cada seguradora (migração 0071).
// Existe separada de listInsuranceQuotes porque preço e capacidade são perguntas
// diferentes: quanto custaria, e se a seguradora ainda comporta este risco.
//
// `recommended` passa a ser escolhida entre quem TEM capacidade — recomendar uma
// seguradora que vai recusar a contratação é a mesma desonestia de mostrar um preço que
// não é o cobrado. Se nenhuma tem capacidade, ninguém é recomendada.
export interface InsuranceQuoteComCapacidade extends InsuranceQuote {
  temCapacidade: boolean;
  motivoSemCapacidade: string | null;
}

export function listInsuranceQuotesComCapacidade(d: DuplicataRow, sandbox = false): InsuranceQuoteComCapacidade[] {
  const anotadas = listInsuranceQuotes(d).map((q) => {
    const veredito = cabeNaCapacidade(q.key, d, sandbox);
    return { ...q, recommended: false, temCapacidade: veredito.ok, motivoSemCapacidade: veredito.ok ? null : veredito.message ?? null };
  });
  const maisBarataComCapacidade = anotadas.find((q) => q.temCapacidade);
  if (maisBarataComCapacidade) maisBarataComCapacidade.recommended = true;
  return anotadas;
}
