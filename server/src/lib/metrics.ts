import type { NextFunction, Request, Response } from 'express';

// Real production observability instead of only Sentry-on-error: latency (p50/p95) and
// error rate per route, computed from actual requests this process has served. A bounded
// ring buffer in memory — no external metrics infra required to get real numbers, but also
// nothing durable across a restart/multi-instance deploy; that trade-off is explicit here,
// not hidden. Good enough to answer "is this slow, is this route erroring" without waiting
// on a real APM integration.

interface RequestSample {
  route: string;
  method: string;
  status: number;
  durationMs: number;
  at: number;
}

const BUFFER_SIZE = 5000;
const samples: RequestSample[] = [];
let writeIndex = 0;

function recordRequest(sample: RequestSample) {
  if (samples.length < BUFFER_SIZE) {
    samples.push(sample);
  } else {
    samples[writeIndex] = sample;
    writeIndex = (writeIndex + 1) % BUFFER_SIZE;
  }
}

// Mount early (app.ts, right after body parsing) so it wraps every route. Reads req.route
// only inside the `finish` handler — by the time a response finishes, Express routing has
// already resolved it, even though this middleware itself runs before route matching.
export function metricsMiddleware(req: Request, res: Response, next: NextFunction) {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    // req.route.path is the route *pattern* ('/:agentId/run'), not the literal URL — keeps
    // cardinality bounded instead of one bucket per unique id ever requested.
    const routePattern = (req as unknown as { route?: { path: string } }).route?.path;
    const route = routePattern ? `${req.baseUrl}${routePattern === '/' ? '' : routePattern}` : req.path;
    recordRequest({ route, method: req.method, status: res.statusCode, durationMs, at: Date.now() });
  });
  next();
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.floor(p * sortedAsc.length));
  return Math.round(sortedAsc[idx] * 10) / 10;
}

export interface RouteMetrics {
  route: string;
  method: string;
  count: number;
  errorCount: number;
  errorRate: number;
  p50Ms: number;
  p95Ms: number;
  avgMs: number;
}

export function computeMetrics(windowMinutes = 60): { windowMinutes: number; totalRequests: number; routes: RouteMetrics[] } {
  const cutoff = Date.now() - windowMinutes * 60_000;
  const byKey = new Map<string, RequestSample[]>();
  let total = 0;
  for (const s of samples) {
    if (s.at < cutoff) continue;
    total++;
    const key = `${s.method} ${s.route}`;
    const arr = byKey.get(key) ?? [];
    arr.push(s);
    byKey.set(key, arr);
  }

  const routes: RouteMetrics[] = [];
  for (const [key, arr] of byKey) {
    const [method, ...routeParts] = key.split(' ');
    const durations = arr.map((a) => a.durationMs).sort((a, b) => a - b);
    const errorCount = arr.filter((a) => a.status >= 500).length;
    routes.push({
      route: routeParts.join(' '),
      method,
      count: arr.length,
      errorCount,
      errorRate: errorCount / arr.length,
      p50Ms: percentile(durations, 0.5),
      p95Ms: percentile(durations, 0.95),
      avgMs: Math.round((durations.reduce((s, d) => s + d, 0) / durations.length) * 10) / 10,
    });
  }
  routes.sort((a, b) => b.count - a.count);
  return { windowMinutes, totalRequests: total, routes };
}

// Test-only escape hatch — the ring buffer is module-level state that would otherwise leak
// between test files sharing this module in the same worker.
export function resetMetricsForTests() {
  samples.length = 0;
  writeIndex = 0;
}
