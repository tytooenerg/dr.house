-- Claude usage/cost metering. Every real call to the Anthropic API from lib/claude.ts
-- (chat, NF-e extraction, contract analysis, risk narrative, dispute/sinistro copilots,
-- PLD second opinion, Compliance AI Engine reasoning) logs one row here with the real
-- token counts the API returned — not an estimate of token count, only of the resulting
-- USD cost (rate is configurable, see db/claudeUsage.ts). Lets an admin see which
-- features are driving spend and whether the per-user rate limit (lib/aiRateLimit.ts)
-- needs tightening, without needing to leave the app to check the Anthropic console.

CREATE TABLE IF NOT EXISTS claude_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feature TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id),
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd REAL NOT NULL DEFAULT 0,
  ok INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_claude_usage_feature ON claude_usage(feature);
CREATE INDEX IF NOT EXISTS idx_claude_usage_created_at ON claude_usage(created_at);
