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

// SQLite CURRENT_TIMESTAMP columns are stored as "YYYY-MM-DD HH:MM:SS" UTC with no
// offset marker; append "Z" so Date parses them as UTC instead of local time.
export function toIsoUtc(sqliteTimestamp: string): string {
  return sqliteTimestamp.includes('T') ? sqliteTimestamp : sqliteTimestamp.replace(' ', 'T') + 'Z';
}

// `vencimento` is stored inconsistently across the codebase — seeded marketplace offers
// use "DD/MM/YYYY" while dates coming from an <input type="date"> are ISO "YYYY-MM-DD".
// Handle both rather than assuming one.
export function parseFlexibleDate(value: string): Date {
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return new Date(value);
  const [d, m, y] = value.split('/');
  return new Date(`${y}-${m}-${d}`);
}

export function fmtRelative(sqliteTimestamp: string): string {
  const then = new Date(toIsoUtc(sqliteTimestamp)).getTime();
  const diffSec = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (diffSec < 60) return 'agora';
  if (diffSec < 3600) return `há ${Math.floor(diffSec / 60)} min`;
  if (diffSec < 86400) return `há ${Math.floor(diffSec / 3600)} h`;
  const days = Math.floor(diffSec / 86400);
  return `há ${days} dia${days > 1 ? 's' : ''}`;
}
