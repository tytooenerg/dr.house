import { db } from './index.js';

// Approximate Claude Sonnet-tier per-million-token pricing, override with the real
// contracted rate via env if it differs — used only to produce a cost *estimate* for the
// admin panel, never for actual billing/invoicing.
const INPUT_PER_MTOK_USD = Number(process.env.CLAUDE_COST_INPUT_PER_MTOK_USD) || 3;
const OUTPUT_PER_MTOK_USD = Number(process.env.CLAUDE_COST_OUTPUT_PER_MTOK_USD) || 15;

export function estimateCostUsd(inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1_000_000) * INPUT_PER_MTOK_USD + (outputTokens / 1_000_000) * OUTPUT_PER_MTOK_USD;
}

export interface ClaudeUsageInput {
  feature: string;
  userId: number | null;
  inputTokens: number;
  outputTokens: number;
  ok: boolean;
}

export function recordClaudeUsage(input: ClaudeUsageInput) {
  const cost = estimateCostUsd(input.inputTokens, input.outputTokens);
  db.prepare(
    `INSERT INTO claude_usage (feature, user_id, input_tokens, output_tokens, estimated_cost_usd, ok) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(input.feature, input.userId, input.inputTokens, input.outputTokens, cost, input.ok ? 1 : 0);
}

export interface ClaudeUsageByFeature {
  feature: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}

export interface ClaudeUsageByDay {
  date: string;
  calls: number;
  estimatedCostUsd: number;
}

export interface ClaudeUsageSummary {
  totalCalls: number;
  failedCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalEstimatedCostUsd: number;
  byFeature: ClaudeUsageByFeature[];
  last30Days: ClaudeUsageByDay[];
}

// Today's estimated spend for one feature (e.g. `agent_${agentId}`) — used by
// lib/agentGovernance.ts to enforce a per-agent daily budget. UTC day boundary (same as
// SQLite's date('now')), a deliberate simplification rather than per-timezone billing.
export function sumFeatureCostToday(feature: string): number {
  const row = db
    .prepare(`SELECT COALESCE(SUM(estimated_cost_usd), 0) as cost FROM claude_usage WHERE feature = ? AND date(created_at) = date('now')`)
    .get(feature) as { cost: number };
  return row.cost;
}

export function getClaudeUsageSummary(): ClaudeUsageSummary {
  const totals = db
    .prepare(
      `SELECT COUNT(*) as calls,
              COALESCE(SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END), 0) as failed,
              COALESCE(SUM(input_tokens), 0) as inputTokens,
              COALESCE(SUM(output_tokens), 0) as outputTokens,
              COALESCE(SUM(estimated_cost_usd), 0) as cost
       FROM claude_usage`
    )
    .get() as { calls: number; failed: number; inputTokens: number; outputTokens: number; cost: number };

  const byFeature = db
    .prepare(
      `SELECT feature,
              COUNT(*) as calls,
              COALESCE(SUM(input_tokens), 0) as inputTokens,
              COALESCE(SUM(output_tokens), 0) as outputTokens,
              COALESCE(SUM(estimated_cost_usd), 0) as cost
       FROM claude_usage
       GROUP BY feature
       ORDER BY cost DESC`
    )
    .all() as { feature: string; calls: number; inputTokens: number; outputTokens: number; cost: number }[];

  const last30Days = db
    .prepare(
      `SELECT date(created_at) as date, COUNT(*) as calls, COALESCE(SUM(estimated_cost_usd), 0) as cost
       FROM claude_usage
       WHERE created_at >= datetime('now', '-30 days')
       GROUP BY date(created_at)
       ORDER BY date ASC`
    )
    .all() as { date: string; calls: number; cost: number }[];

  return {
    totalCalls: totals.calls,
    failedCalls: totals.failed,
    totalInputTokens: totals.inputTokens,
    totalOutputTokens: totals.outputTokens,
    totalEstimatedCostUsd: totals.cost,
    byFeature: byFeature.map((r) => ({ feature: r.feature, calls: r.calls, inputTokens: r.inputTokens, outputTokens: r.outputTokens, estimatedCostUsd: r.cost })),
    last30Days: last30Days.map((r) => ({ date: r.date, calls: r.calls, estimatedCostUsd: r.cost })),
  };
}
