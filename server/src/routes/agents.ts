import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { aiFeatureLimiter } from '../lib/aiRateLimit.js';
import { claudeEnabled } from '../lib/claude.js';
import { runAgent, executeApprovedTool } from '../lib/agentRuntime.js';
import { AGENTS, listAgentSummaries, getAgent, canRunSelfService } from '../lib/agents/index.js';
import {
  getAgentRun,
  listAgentSteps,
  listAgentRuns,
  listAgentRunsForUser,
  listPendingActions,
  listPendingActionsForUser,
  getPendingAction,
  decidePendingAction,
} from '../db/agents.js';

// Two access levels share this router:
//  - admin: sees/runs every agent, against any account, and approves/rejects anything.
//  - self-service (cedente → emissao, investidor → autobid, see AgentDefinition.selfServiceRoles):
//    can only run the agent(s) their role is allowed, always forced onto their OWN account
//    (never another user's), only ever sees their own runs/pending actions, and can only
//    approve/reject a pending action that is both theirs AND marked selfApprovable — a
//    tool that mirrors something they could already do unassisted (emit a duplicata,
//    buy an offer). Every other sensitive tool (PLD, KYB, legal/regulatory) stays
//    admin-only regardless of who triggered the run.
export const agentsRouter = Router();
agentsRouter.use(requireAuth);

function isAdmin(role: string): role is 'admin' {
  return role === 'admin';
}

agentsRouter.get('/', (req, res) => {
  res.json({ llmEnabled: claudeEnabled, agents: listAgentSummaries(req.user!.role) });
});

agentsRouter.get('/runs', (req, res) => {
  const runs = isAdmin(req.user!.role) ? listAgentRuns(50) : listAgentRunsForUser(req.user!.id, 50);
  res.json({ runs });
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
    if (!isAdmin(req.user!.role) && run.user_id !== req.user!.id) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    res.json({ run, steps: listAgentSteps(runId) });
  })
);

agentsRouter.get('/pending', (req, res) => {
  const pending = isAdmin(req.user!.role) ? listPendingActions('pendente') : listPendingActionsForUser(req.user!.id, 'pendente');
  res.json({ pending });
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
    const admin = isAdmin(req.user!.role);
    if (!admin && !canRunSelfService(def, req.user!.role)) {
      res.status(403).json({ error: 'forbidden', message: `Seu papel não tem acesso ao agente "${def.label}".` });
      return;
    }
    const parsed = runSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    const { input, actingUserId, subjectType, subjectId } = parsed.data;
    // Self-service is always forced onto the caller's own account — a non-admin cannot
    // pass actingUserId to run an agent "as" someone else, no matter what the request body
    // says.
    const effectiveUserId = admin ? (actingUserId ?? req.user!.id) : req.user!.id;
    const outcome = await runAgent(def, { input, userId: effectiveUserId, subjectType, subjectId });
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
    const admin = isAdmin(req.user!.role);
    if (!admin) {
      const tool = def.tools.find((t) => t.name === pending.tool_name);
      const isOwn = !!run && run.user_id === req.user!.id;
      if (!isOwn || !tool?.selfApprovable) {
        res.status(403).json({ error: 'forbidden', message: 'Apenas um admin pode decidir esta ação.' });
        return;
      }
    }
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
    const admin = isAdmin(req.user!.role);
    if (!admin) {
      const def = getAgent(pending.agent_id);
      const tool = def?.tools.find((t) => t.name === pending.tool_name);
      const run = getAgentRun(pending.run_id);
      const isOwn = !!run && run.user_id === req.user!.id;
      if (!isOwn || !tool?.selfApprovable) {
        res.status(403).json({ error: 'forbidden', message: 'Apenas um admin pode decidir esta ação.' });
        return;
      }
    }
    const parsed = decisionSchema.safeParse(req.body);
    decidePendingAction(id, 'rejeitada', req.user!.id, { note: parsed.success ? parsed.data.note ?? null : null });
    res.json({ ok: true });
  })
);
