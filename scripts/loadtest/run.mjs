#!/usr/bin/env node
// Dependency-free load test — no new package to install, just Node's built-in fetch
// (Node 18+). Logs in as a real seeded demo account, then hammers a mix of real endpoints
// (public + authenticated) with N concurrent workers for a fixed duration, and reports
// real p50/p95/error-rate numbers — not a synthetic estimate.
//
// Usage:
//   node scripts/loadtest/run.mjs [--url http://localhost:4000] [--duration 15] [--concurrency 10]
//
// The server must already be running (npm run dev, or a production build) and seeded
// (npm run dev seeds automatically in development).

const args = process.argv.slice(2);
function argValue(flag, fallback) {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
}

const BASE_URL = argValue('--url', process.env.LOADTEST_URL || 'http://localhost:4000');
const DURATION_SEC = Number(argValue('--duration', process.env.LOADTEST_DURATION || 15));
const CONCURRENCY = Number(argValue('--concurrency', process.env.LOADTEST_CONCURRENCY || 10));
const DEMO_EMAIL = 'investidor@lastro.demo';
const DEMO_PASSWORD = 'demo1234';

async function login() {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: DEMO_EMAIL, password: DEMO_PASSWORD }),
  });
  if (!res.ok) throw new Error(`login falhou (${res.status}) — o servidor está rodando e com o seed de demo carregado?`);
  const body = await res.json();
  return body.token;
}

function buildScenarios(token) {
  const authHeaders = { Authorization: `Bearer ${token}` };
  return [
    { name: 'GET /api/health', weight: 1, request: () => fetch(`${BASE_URL}/api/health`) },
    { name: 'GET /api/public/stats', weight: 3, request: () => fetch(`${BASE_URL}/api/public/stats`) },
    { name: 'GET /api/market', weight: 4, request: () => fetch(`${BASE_URL}/api/market`, { headers: authHeaders }) },
    { name: 'GET /api/dashboard', weight: 3, request: () => fetch(`${BASE_URL}/api/dashboard`, { headers: authHeaders }) },
    { name: 'GET /api/minhas', weight: 2, request: () => fetch(`${BASE_URL}/api/minhas`, { headers: authHeaders }) },
  ];
}

function pickWeighted(scenarios) {
  const total = scenarios.reduce((s, sc) => s + sc.weight, 0);
  let r = Math.random() * total;
  for (const sc of scenarios) {
    if (r < sc.weight) return sc;
    r -= sc.weight;
  }
  return scenarios[scenarios.length - 1];
}

function percentile(sortedAsc, p) {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.floor(p * sortedAsc.length));
  return Math.round(sortedAsc[idx] * 10) / 10;
}

async function worker(scenarios, results, stopAt) {
  while (Date.now() < stopAt) {
    const scenario = pickWeighted(scenarios);
    const start = performance.now();
    try {
      const res = await scenario.request();
      const durationMs = performance.now() - start;
      results.push({ scenario: scenario.name, status: res.status, durationMs });
    } catch (err) {
      const durationMs = performance.now() - start;
      results.push({ scenario: scenario.name, status: 0, durationMs, error: String(err) });
    }
  }
}

async function main() {
  console.log(`[loadtest] alvo: ${BASE_URL} — duração: ${DURATION_SEC}s — concorrência: ${CONCURRENCY}`);
  console.log('[loadtest] autenticando com conta de demo…');
  const token = await login();
  const scenarios = buildScenarios(token);

  const results = [];
  const stopAt = Date.now() + DURATION_SEC * 1000;
  const startedAt = Date.now();
  console.log('[loadtest] disparando carga real…');
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(scenarios, results, stopAt)));
  const elapsedSec = (Date.now() - startedAt) / 1000;

  const byScenario = new Map();
  for (const r of results) {
    const arr = byScenario.get(r.scenario) ?? [];
    arr.push(r);
    byScenario.set(r.scenario, arr);
  }

  console.log('\n[loadtest] resultado — números reais desta execução, não uma estimativa:\n');
  console.log('cenário'.padEnd(28), 'reqs'.padStart(6), 'erros'.padStart(6), 'p50ms'.padStart(8), 'p95ms'.padStart(8), 'avgMs'.padStart(8));
  let totalReqs = 0;
  let totalErrors = 0;
  for (const [name, arr] of byScenario) {
    const durations = arr.map((a) => a.durationMs).sort((a, b) => a - b);
    const errors = arr.filter((a) => a.status === 0 || a.status >= 500).length;
    totalReqs += arr.length;
    totalErrors += errors;
    const avg = Math.round((durations.reduce((s, d) => s + d, 0) / durations.length) * 10) / 10;
    console.log(
      name.padEnd(28),
      String(arr.length).padStart(6),
      String(errors).padStart(6),
      String(percentile(durations, 0.5)).padStart(8),
      String(percentile(durations, 0.95)).padStart(8),
      String(avg).padStart(8)
    );
  }
  console.log(`\n[loadtest] total: ${totalReqs} requisições em ${elapsedSec.toFixed(1)}s (~${(totalReqs / elapsedSec).toFixed(1)} req/s) — ${totalErrors} erro(s) (${((totalErrors / totalReqs) * 100).toFixed(2)}%)`);
}

main().catch((err) => {
  console.error('[loadtest] falhou:', err.message);
  process.exit(1);
});
