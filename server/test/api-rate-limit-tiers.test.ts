import { describe, expect, it } from 'vitest';
import { computeApiKeyLimitPerMin } from '../src/auth/apiKey.js';
import type { ApiKeyRow, UserRow } from '../src/db/types.js';

// Unit-level: exercises the tiering function directly rather than actually burning a
// real per-minute budget over HTTP (server/test/partner-api-rate-limit.test.ts already
// covers the real 429 path end-to-end, with API_RATE_LIMIT_PER_MIN stubbed to a small
// deterministic number).

function apiKey(overrides: Partial<ApiKeyRow>): ApiKeyRow {
  return {
    id: 1,
    user_id: 1,
    key_hash: 'x',
    key_prefix: 'lastro_live_x',
    label: 'test',
    revoked: 0,
    mode: 'live',
    scope: 'read_write',
    product: 'platform',
    last_used_at: null,
    created_at: '',
    ...overrides,
  };
}

function user(plan: UserRow['plan']): UserRow {
  return { plan } as UserRow;
}

describe('computeApiKeyLimitPerMin', () => {
  it('gives a sandbox (test-mode) key the modest exploration budget, regardless of the account plan', () => {
    expect(computeApiKeyLimitPerMin(apiKey({ mode: 'test' }), user('empresarial'))).toBe(60);
    expect(computeApiKeyLimitPerMin(apiKey({ mode: 'test' }), user('basico'))).toBe(60);
  });

  it('scales a live platform key with the account plan', () => {
    expect(computeApiKeyLimitPerMin(apiKey({ mode: 'live', product: 'platform' }), user('basico'))).toBe(60);
    expect(computeApiKeyLimitPerMin(apiKey({ mode: 'live', product: 'platform' }), user('pro'))).toBe(150);
    expect(computeApiKeyLimitPerMin(apiKey({ mode: 'live', product: 'platform' }), user('empresarial'))).toBe(400);
  });

  it('gives a standalone data-product key its own tier, independent of the account plan', () => {
    expect(computeApiKeyLimitPerMin(apiKey({ mode: 'live', product: 'score_api' }), user('basico'))).toBe(200);
    expect(computeApiKeyLimitPerMin(apiKey({ mode: 'live', product: 'pld_screening_api' }), user('empresarial'))).toBe(200);
  });

  it('an explicit API_RATE_LIMIT_PER_MIN override always wins over every tier', () => {
    const original = process.env.API_RATE_LIMIT_PER_MIN;
    process.env.API_RATE_LIMIT_PER_MIN = '7';
    try {
      expect(computeApiKeyLimitPerMin(apiKey({ mode: 'live', product: 'platform' }), user('empresarial'))).toBe(7);
      expect(computeApiKeyLimitPerMin(apiKey({ mode: 'test' }), user('basico'))).toBe(7);
    } finally {
      if (original === undefined) delete process.env.API_RATE_LIMIT_PER_MIN;
      else process.env.API_RATE_LIMIT_PER_MIN = original;
    }
  });
});
