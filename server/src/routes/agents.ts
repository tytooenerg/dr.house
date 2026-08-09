import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { aiFeatureLimiter } from '../lib/aiRateLimit.js';
import { claudeEnabled } from '../lib/claude.js';
import { runAgent, executeApprovedTool } from '../lib/agentRuntime.js';
import { AGENTS, listAgentSummaries, getAgent } from '../lib/agents/index.js';
import { getAgentRun, listAgentSteps, listAgentRuns, listPendingActions, getPendingAction, decidePendingAction } from '../db/agents.js';

// The whole agentic layer is admin-gated for now: several tools here take real,
// consequential actions (money movement, KYB decisions, legal escalation) once approved,
// so this stays an internal console rather than something any role can hit directly. A
// cedente/investidor self-service version (an agent acting only on its own account) is a
// natural next step but needs its own scoping rules — not built here.
export const agentsRouter = Router();
agentsRouter.use(requireAuth, requireRole('admin'));

agentsRouter.get('/', (_req, res) => {
  res.json({ llmEnabled: claudeEnabled, agents: listAgentSummaries() });
});

agentsRouter.get('/runs', (_req, res) => {
  res.json({ runs: listAgentRuns(50) });
});

agentsRouter.get(
  '/runs/:id',
  asyncHandler(async (req, res) => {
    const runId = Number(req.params.id);
    const run = getAgentRun(runId);
    if (!run) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json({ run, steps: listAgentSteps(runId) });
  })
);

agentsRouter.get('/pending', (_req, res) => {
  res.json({ pending: listPendingActions('pendente') });
});

const runSchema = z.object({
  input: z.string().trim().min(1).max(4000),
  actingUserId: z.number().int().positive().optional(),
  subjectType: z.string().trim().max(60).optional(),
  subjectId: z.string().trim().max(120).optional(),
});

agentsRouter.post(
  '/:agentId/run',
  aiFeatureLimiter,
  asyncHandler(async (req, res) => {
    const def = getAgent(req.params.agentId);
    if (!def) {
      res.status(404).json({ error: 'not_found', message: `Agente "${req.params.agentId}" não existe. Agentes disponíveis: ${Object.keys(AGENTS).join(', ')}` });
      return;
    }
    const parsed = runSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    const { input, actingUserId, subjectType, subjectId } = parsed.data;
    const outcome = await runAgent(def, { input, userId: actingUserId ?? req.user!.id, subjectType, subjectId });
    res.json(outcome);
  })
);

const decisionSchema = z.object({ note: z.string().trim().max(1000).optional() });

agentsRouter.post(
  '/pending/:id/approve',
  aiFeatureLimiter,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const pending = getPendingAction(id);
    if (!pending) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    if (pending.status !== 'pendente') {
      res.status(409).json({ error: 'already_decided', status: pending.status });
      return;
    }
    decisionSchema.safeParse(req.body);
    const def = getAgent(pending.agent_id);
    if (!def) {
      res.status(500).json({ error: 'agent_missing', message: `Agente "${pending.agent_id}" não está mais registrado.` });
      return;
    }
    const run = getAgentRun(pending.run_id);
    try {
      const input = JSON.parse(pending.input);
      const output = await executeApprovedTool(def, pending.tool_name, input, { runId: pending.run_id, userId: run?.user_id ?? req.user!.id });
      decidePendingAction(id, 'aprovada', req.user!.id, { ok: true, output });
      res.json({ ok: true, output });
    } catch (err) {
      decidePendingAction(id, 'aprovada', req.user!.id, { ok: false, error: String(err) });
      res.status(500).json({ error: 'execution_failed', message: String(err) });
    }
  })
);

agentsRouter.post(
  '/pending/:id/reject',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const pending = getPendingAction(id);
    if (!pending) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    if (pending.status !== 'pendente') {
      res.status(409).json({ error: 'already_decided', status: pending.status });
      return;
    }
    const parsed = decisionSchema.safeParse(req.body);
    decidePendingAction(id, 'rejeitada', req.user!.id, { note: parsed.success ? parsed.data.note ?? null : null });
    res.json({ ok: true });
  })
);
