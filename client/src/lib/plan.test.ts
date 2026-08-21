import { describe, expect, it } from 'vitest';
import { planAtLeast } from './plan';

describe('planAtLeast', () => {
  it('treats a plan as satisfying its own requirement', () => {
    expect(planAtLeast('pro', 'pro')).toBe(true);
  });

  it('treats a higher plan as satisfying a lower requirement', () => {
    expect(planAtLeast('empresarial', 'pro')).toBe(true);
    expect(planAtLeast('empresarial', 'basico')).toBe(true);
  });

  it('rejects a lower plan against a higher requirement', () => {
    expect(planAtLeast('basico', 'pro')).toBe(false);
    expect(planAtLeast('pro', 'empresarial')).toBe(false);
  });
});
