import { describe, expect, it, beforeEach } from 'vitest';
import { cacheGet, cacheSet, cacheDel, cached, cacheBackend, resetMemCacheForTests } from '../src/lib/cache.js';

beforeEach(() => {
  resetMemCacheForTests();
});

describe('cache — in-memory fallback (no REDIS_URL in tests)', () => {
  it('reports the memory backend when REDIS_URL is not configured', () => {
    expect(cacheBackend()).toBe('memoria');
  });

  it('round-trips a value', async () => {
    await cacheSet('k1', { a: 1 }, 60);
    const got = await cacheGet<{ a: number }>('k1');
    expect(got).toEqual({ a: 1 });
  });

  it('misses on an unset key', async () => {
    expect(await cacheGet('nope')).toBeNull();
  });

  it('expires after the TTL', async () => {
    await cacheSet('k2', 'v', 0); // already-expired TTL
    await new Promise((r) => setTimeout(r, 5));
    expect(await cacheGet('k2')).toBeNull();
  });

  it('cacheDel removes a key', async () => {
    await cacheSet('k3', 'v', 60);
    await cacheDel('k3');
    expect(await cacheGet('k3')).toBeNull();
  });

  it('cached() computes once and reuses the cached value on the next call', async () => {
    let calls = 0;
    const compute = () => {
      calls++;
      return 'computed';
    };
    const first = await cached('k4', 60, compute);
    const second = await cached('k4', 60, compute);
    expect(first).toBe('computed');
    expect(second).toBe('computed');
    expect(calls).toBe(1);
  });

  it('never breaks the caller even if the compute function is what fails', async () => {
    await expect(
      cached('k5', 60, () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    // The failure came from compute(), not from the cache layer itself — a subsequent
    // read of the same key is still a clean miss (nothing was cached).
    expect(await cacheGet('k5')).toBeNull();
  });
});
