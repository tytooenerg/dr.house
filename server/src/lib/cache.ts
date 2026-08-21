import { Redis } from 'ioredis';
import { logger } from './logger.js';

// Optional cache for hot reads — same real-when-configured shape as ws.ts's Redis pub/sub
// relay. With a single API process (the default for this app), an in-memory Map with a
// TTL already gets almost all of the benefit; REDIS_URL only matters once this process is
// scaled horizontally and the cache needs to be shared/invalidated across instances. A
// failure to read or write the cache (Redis down, whatever) never breaks the caller — it
// just falls through as a cache miss, same as every other "real-when-configured" adapter
// in this codebase never turning a missing/broken integration into a hard failure.

let redis: Redis | null = null;
const url = process.env.REDIS_URL;
if (url) {
  redis = new Redis(url);
  redis.on('error', (err) => logger.error({ err }, '[cache] erro de conexão com o Redis'));
}

interface MemEntry {
  value: string;
  expiresAt: number;
}
const memCache = new Map<string, MemEntry>();
const MEM_CACHE_MAX_ENTRIES = 5000;

function memGet(key: string): string | null {
  const entry = memCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memCache.delete(key);
    return null;
  }
  return entry.value;
}

function memSet(key: string, value: string, ttlSeconds: number) {
  if (memCache.size >= MEM_CACHE_MAX_ENTRIES && !memCache.has(key)) {
    // Not true LRU — evicts whatever was inserted first (Map preserves insertion order).
    // Simple and bounded, which is the actual requirement for a long-running process;
    // real LRU precision isn't worth the complexity for a fallback path.
    const oldestKey = memCache.keys().next().value;
    if (oldestKey !== undefined) memCache.delete(oldestKey);
  }
  memCache.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const raw = redis ? await redis.get(key) : memGet(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch (err) {
    logger.warn({ err, key }, '[cache] falha ao ler — seguindo sem cache');
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  try {
    const raw = JSON.stringify(value);
    if (redis) await redis.set(key, raw, 'EX', ttlSeconds);
    else memSet(key, raw, ttlSeconds);
  } catch (err) {
    logger.warn({ err, key }, '[cache] falha ao gravar — seguindo sem cache');
  }
}

export async function cacheDel(key: string): Promise<void> {
  try {
    if (redis) await redis.del(key);
    else memCache.delete(key);
  } catch (err) {
    logger.warn({ err, key }, '[cache] falha ao invalidar');
  }
}

// A convenience wrapper for the common "read cache, else compute and store" shape.
export async function cached<T>(key: string, ttlSeconds: number, compute: () => Promise<T> | T): Promise<T> {
  const hit = await cacheGet<T>(key);
  if (hit !== null) return hit;
  const value = await compute();
  await cacheSet(key, value, ttlSeconds);
  return value;
}

export function cacheBackend(): 'redis' | 'memoria' {
  return redis ? 'redis' : 'memoria';
}

export function resetMemCacheForTests() {
  memCache.clear();
}
