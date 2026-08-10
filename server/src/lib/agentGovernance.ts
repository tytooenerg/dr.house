import { getPlatformSetting, setPlatformSetting, getFloatSetting, getIntSetting } from '../db/platformSettings.js';
import { sumFeatureCostToday } from '../db/claudeUsage.js';

// Governance controls for the agentic layer — separate from the per-tool `sensitive`
// approval gate (agentRuntime.ts), which decides whether one action needs a human. These
// decide whether an agent gets to run *at all* right now, and how many humans a
// high-value action needs. Reuses the existing platform_settings key/value store (same
// one the Compliance Engine threshold already lives in) rather than a bespoke table —
// every setting here is a single admin-configurable value, no relational shape needed.

export function isAgentEnabled(agentId: string): boolean {
  return getIntSetting(`agent_enabled:${agentId}`, 1) === 1;
}

export function setAgentEnabled(agentId: string, enabled: boolean, updatedBy?: number) {
  setPlatformSetting(`agent_enabled:${agentId}`, enabled ? '1' : '0', updatedBy);
}

// null = no budget configured, meaning unlimited (the default — matches every other
// optional limit in this codebase, e.g. compliance threshold has a real default instead).
export function getAgentDailyBudgetUsd(agentId: string): number | null {
  const raw = getPlatformSetting(`agent_daily_budget_usd:${agentId}`);
  if (raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function setAgentDailyBudgetUsd(agentId: string, value: number | null, updatedBy?: number) {
  setPlatformSetting(`agent_daily_budget_usd:${agentId}`, value === null ? '' : String(value), updatedBy);
}

export function agentSpentTodayUsd(agentId: string): number {
  return sumFeatureCostToday(`agent_${agentId}`);
}

export function isAgentOverBudget(agentId: string): boolean {
  const budget = getAgentDailyBudgetUsd(agentId);
  if (budget === null) return false;
  return agentSpentTodayUsd(agentId) >= budget;
}

const DUAL_APPROVAL_THRESHOLD_KEY = 'agent_dual_approval_threshold_brl';
export const DEFAULT_DUAL_APPROVAL_THRESHOLD_BRL = 100_000;

// Any admin-approved (not self-service) sensitive action whose real monetary value (see
// AgentToolDef.extractValueBRL) is at or above this threshold requires two distinct
// admins to approve before the handler actually runs — not just one click. Self-service
// approval (the account owner confirming their own agent's proposal) is never subject to
// this: it already mirrors an action they could take unassisted with no such gate.
export function getDualApprovalThresholdBrl(): number {
  return getFloatSetting(DUAL_APPROVAL_THRESHOLD_KEY, DEFAULT_DUAL_APPROVAL_THRESHOLD_BRL);
}

export function setDualApprovalThresholdBrl(value: number, updatedBy?: number) {
  setPlatformSetting(DUAL_APPROVAL_THRESHOLD_KEY, String(value), updatedBy);
}
