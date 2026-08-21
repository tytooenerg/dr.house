-- Agent governance: dual-approval support. Kill switch and per-agent daily budget reuse
-- the existing platform_settings key/value table (see lib/agentGovernance.ts) — no schema
-- change needed for those. Dual approval needs real bookkeeping: how many approvals a
-- given pending action requires, and who has already approved it (so the same admin can't
-- count twice).
ALTER TABLE agent_pending_actions ADD COLUMN approvals_required INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS agent_pending_approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pending_action_id INTEGER NOT NULL REFERENCES agent_pending_actions(id),
  admin_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(pending_action_id, admin_id)
);
CREATE INDEX IF NOT EXISTS idx_agent_pending_approvals_action ON agent_pending_approvals(pending_action_id);
