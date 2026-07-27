import crypto from 'node:crypto';
import { db } from '../db/index.js';

interface IdempotencyRow {
  request_hash: string;
  response_status: number;
  response_body: string;
}

function hashBody(body: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(body ?? {})).digest('hex');
}

// Mirrors Stripe's Idempotency-Key contract: replaying the same key + route with the
// same request body returns the original response instead of re-running side effects
// (double-emitting a duplicata, double-deciding a sinistro, …); replaying with a
// different body is a conflict, since the key almost certainly means something else.
export async function withIdempotency<T extends { status: number; body: unknown }>(
  userId: number,
  route: string,
  idempotencyKey: string | undefined,
  requestBody: unknown,
  compute: () => Promise<T> | T
): Promise<T | { status: 409; body: { error: 'idempotency_key_conflict'; message: string } }> {
  if (!idempotencyKey) return compute();

  const existing = db
    .prepare('SELECT request_hash, response_status, response_body FROM idempotency_keys WHERE user_id = ? AND key = ? AND route = ?')
    .get(userId, idempotencyKey, route) as IdempotencyRow | undefined;

  const requestHash = hashBody(requestBody);
  if (existing) {
    if (existing.request_hash !== requestHash) {
      return {
        status: 409,
        body: { error: 'idempotency_key_conflict', message: 'Essa Idempotency-Key já foi usada com um corpo de requisição diferente.' },
      };
    }
    return { status: existing.response_status, body: JSON.parse(existing.response_body) } as T;
  }

  const outcome = await compute();
  // Only successful outcomes are cached — a transient failure (e.g. the simulated CERC
  // 502) isn't a "this already happened" result, it's exactly the kind of thing a caller
  // is expected to retry, so the same key must be free to try again until it succeeds.
  if (outcome.status >= 200 && outcome.status < 300) {
    db.prepare(
      `INSERT INTO idempotency_keys (user_id, key, route, request_hash, response_status, response_body) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, key, route) DO NOTHING`
    ).run(userId, idempotencyKey, route, requestHash, outcome.status, JSON.stringify(outcome.body));
  }
  return outcome;
}
