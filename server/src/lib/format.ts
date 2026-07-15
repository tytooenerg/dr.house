import { COLORS } from '../data/seed.js';

export function fmtBRL(n: number): string {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}

export function scoreColorFor(score: number): string {
  if (score >= 75) return COLORS.GREEN;
  if (score >= 55) return COLORS.AMBER;
  return COLORS.RED;
}

export function ratingColors(rating: string): { bg: string; color: string } {
  if (rating === 'AA' || rating === 'A') return { bg: '#EAF3EE', color: COLORS.GREEN };
  if (rating === 'B') return { bg: '#FBF1E0', color: COLORS.AMBER };
  return { bg: '#F7E9E7', color: COLORS.RED };
}

export function parseBRLNumber(s: string | undefined): number {
  if (!s) return 0;
  return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
}
