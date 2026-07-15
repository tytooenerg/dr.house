import { describe, expect, it } from 'vitest';
import { fmtBRL, fmtRelative, parseBRLNumber, ratingColors, scoreColorFor, toIsoUtc } from '../src/lib/format.js';

describe('fmtBRL', () => {
  it('formats whole reais with the BRL symbol', () => {
    expect(fmtBRL(84500)).toBe('R$ 84.500');
  });
  it('rounds to the nearest real (no cents)', () => {
    expect(fmtBRL(84500.6)).toBe('R$ 84.501');
  });
});

describe('parseBRLNumber', () => {
  it('parses pt-BR thousand/decimal separators', () => {
    expect(parseBRLNumber('84.500,50')).toBeCloseTo(84500.5);
  });
  it('returns 0 for empty/undefined input', () => {
    expect(parseBRLNumber('')).toBe(0);
    expect(parseBRLNumber(undefined)).toBe(0);
  });
  it('returns 0 for garbage input rather than NaN', () => {
    expect(parseBRLNumber('não é número')).toBe(0);
  });
});

describe('scoreColorFor', () => {
  it('buckets scores into green/amber/red', () => {
    expect(scoreColorFor(90)).toBe('#0A5C36');
    expect(scoreColorFor(60)).toBe('#B8790A');
    expect(scoreColorFor(30)).toBe('#B03A2E');
  });
  it('treats the boundaries as inclusive on the lower bound', () => {
    expect(scoreColorFor(75)).toBe('#0A5C36');
    expect(scoreColorFor(55)).toBe('#B8790A');
    expect(scoreColorFor(54)).toBe('#B03A2E');
  });
});

describe('ratingColors', () => {
  it('maps AA and A to the same green treatment', () => {
    expect(ratingColors('AA')).toEqual({ bg: '#EAF3EE', color: '#0A5C36' });
    expect(ratingColors('A')).toEqual({ bg: '#EAF3EE', color: '#0A5C36' });
  });
  it('maps B to amber and anything else to red', () => {
    expect(ratingColors('B').color).toBe('#B8790A');
    expect(ratingColors('C').color).toBe('#B03A2E');
  });
});

describe('toIsoUtc / fmtRelative', () => {
  it('appends Z to bare SQLite timestamps so they parse as UTC', () => {
    expect(toIsoUtc('2026-07-15 22:29:44')).toBe('2026-07-15T22:29:44Z');
  });
  it('leaves already-ISO timestamps untouched', () => {
    expect(toIsoUtc('2026-07-15T22:29:44.000Z')).toBe('2026-07-15T22:29:44.000Z');
  });
  it('reports a just-now timestamp as "agora"', () => {
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    expect(fmtRelative(now)).toBe('agora');
  });
});
