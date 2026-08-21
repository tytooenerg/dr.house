-- Real sandbox data isolation (server/src/lib/sandboxData.ts) — closes the gap where a
-- test-mode partner API key ("lastro_test_...") read/wrote the exact same account data
-- as a live key, distinguished only by a label. Duplicatas created via a test-mode key
-- are tagged sandbox=1 and are filtered out of every live/internal read path (Minhas
-- Duplicatas, Marketplace, Portal do Sacado's monthly emit-limit counting, seguradora
-- claim queues) at the query layer in db/duplicatas.ts — not just hidden in the UI.
ALTER TABLE duplicatas ADD COLUMN sandbox INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_duplicatas_sandbox ON duplicatas(sandbox);
