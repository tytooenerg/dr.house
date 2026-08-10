import { db } from './index.js';

export type AgentRunMode = 'llm' | 'simulado';
export type AgentRunStatus = 'em_andamento' | 'concluido' | 'limite_de_passos' | 'erro' | 'simulado';
export type AgentStepType = 'assistente' | 'ferramenta' | 'erro_ferramenta' | 'pendente_aprovacao' | 'final' | 'erro';
export type AgentPendingStatus = 'pendente' | 'aprovada' | 'rejeitada';

export interface AgentRunRow {
  id: number;
  agent_id: string;
  user_id: number | null;
  subject_type: string | null;
  subject_id: string | null;
  input: string;
  mode: AgentRunMode;
  status: AgentRunStatus;
  summary: string | null;
  created_at: string;
  finished_at: string | null;
}

export interface AgentStepRow {
  id: number;
  run_id: number;
  step_no: number;
  type: AgentStepType;
  tool_name: string | null;
  payload: string;
  created_at: string;
}

export interface AgentPendingActionRow {
  id: number;
  run_id: number;
  agent_id: string;
  tool_name: string;
  input: string;
  status: AgentPendingStatus;
  result: string | null;
  decided_by: number | null;
  decided_at: string | null;
  created_at: string;
}

export function createAgentRun(input: {
  agentId: string;
  userId: number | null;
  subjectType: string | null;
  subjectId: string | null;
  input: string;
  mode: AgentRunMode;
}): number {
  const info = db
    .prepare(`INSERT INTO agent_runs (agent_id, user_id, subject_type, subject_id, input, mode) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(input.agentId, input.userId, input.subjectType, input.subjectId, input.input, input.mode);
  return info.lastInsertRowid as number;
}

export function finishAgentRun(runId: number, status: AgentRunStatus, summary: string) {
  db.prepare(`UPDATE agent_runs SET status = ?, summary = ?, finished_at = datetime('now') WHERE id = ?`).run(status, summary, runId);
}

export function addAgentStep(runId: number, stepNo: number, type: AgentStepType, toolName: string | null, payload: unknown): number {
  const info = db
    .prepare(`INSERT INTO agent_steps (run_id, step_no, type, tool_name, payload) VALUES (?, ?, ?, ?, ?)`)
    .run(runId, stepNo, type, toolName, JSON.stringify(payload ?? null));
  return info.lastInsertRowid as number;
}

export function getAgentRun(runId: number): AgentRunRow | undefined {
  return db.prepare('SELECT * FROM agent_runs WHERE id = ?').get(runId) as AgentRunRow | undefined;
}

export function listAgentSteps(runId: number): AgentStepRow[] {
  return db.prepare('SELECT * FROM agent_steps WHERE run_id = ? ORDER BY id ASC').all(runId) as AgentStepRow[];
}

export function listAgentRuns(limit = 50): AgentRunRow[] {
  return db.prepare('SELECT * FROM agent_runs ORDER BY id DESC LIMIT ?').all(limit) as AgentRunRow[];
}

// Self-service scoping (routes/agents.ts): a non-admin only ever sees runs where they were
// the acting user — never another account's, and never a system-triggered run (user_id
// null, e.g. the cobrança/onboarding background agents).
export function listAgentRunsForUser(userId: number, limit = 50): AgentRunRow[] {
  return db.prepare('SELECT * FROM agent_runs WHERE user_id = ? ORDER BY id DESC LIMIT ?').all(userId, limit) as AgentRunRow[];
}

// Most recent run of a given agent against a given subject (e.g. agent_id='onboarding',
// subjectType='user', subjectId=String(userId)) — used to surface an already-computed
// AI pre-triage instead of re-running it (routes/admin.ts KYB queue).
export function getLatestAgentRunForSubject(agentId: string, subjectType: string, subjectId: string): AgentRunRow | undefined {
  return db
    .prepare('SELECT * FROM agent_runs WHERE agent_id = ? AND subject_type = ? AND subject_id = ? ORDER BY id DESC LIMIT 1')
    .get(agentId, subjectType, subjectId) as AgentRunRow | undefined;
}

// Dedup guard for background jobs (cobrança agent scan) — skip a subject that was already
// scanned recently regardless of outcome, so a job running every few hours doesn't re-spend
// tokens investigating the same case over and over while nothing has changed.
export function hasRecentAgentRun(agentId: string, subjectType: string, subjectId: string, hours: number): boolean {
  const row = db
    .prepare(
      `SELECT 1 FROM agent_runs WHERE agent_id = ? AND subject_type = ? AND subject_id = ? AND created_at >= datetime('now', ?) LIMIT 1`
    )
    .get(agentId, subjectType, subjectId, `-${hours} hours`);
  return !!row;
}

export function createPendingAction(input: { runId: number; agentId: string; toolName: string; input: unknown }): number {
  const info = db
    .prepare(`INSERT INTO agent_pending_actions (run_id, agent_id, tool_name, input) VALUES (?, ?, ?, ?)`)
    .run(input.runId, input.agentId, input.toolName, JSON.stringify(input.input ?? null));
  return info.lastInsertRowid as number;
}

export function getPendingAction(id: number): AgentPendingActionRow | undefined {
  return db.prepare('SELECT * FROM agent_pending_actions WHERE id = ?').get(id) as AgentPendingActionRow | undefined;
}

export function listPendingActions(status: AgentPendingStatus = 'pendente'): AgentPendingActionRow[] {
  return db.prepare('SELECT * FROM agent_pending_actions WHERE status = ? ORDER BY id DESC').all(status) as AgentPendingActionRow[];
}

// Self-service scoping: a non-admin only ever sees pending actions from their own runs.
export function listPendingActionsForUser(userId: number, status: AgentPendingStatus = 'pendente'): AgentPendingActionRow[] {
  return db
    .prepare(
      `SELECT p.* FROM agent_pending_actions p JOIN agent_runs r ON r.id = p.run_id WHERE r.user_id = ? AND p.status = ? ORDER BY p.id DESC`
    )
    .all(userId, status) as AgentPendingActionRow[];
}

export function listPendingActionsForRun(runId: number): AgentPendingActionRow[] {
  return db.prepare('SELECT * FROM agent_pending_actions WHERE run_id = ? ORDER BY id DESC').all(runId) as AgentPendingActionRow[];
}

export function decidePendingAction(id: number, status: 'aprovada' | 'rejeitada', decidedBy: number, result: unknown) {
  db.prepare(`UPDATE agent_pending_actions SET status = ?, result = ?, decided_by = ?, decided_at = datetime('now') WHERE id = ?`).run(
    status,
    JSON.stringify(result ?? null),
    decidedBy,
    id
  );
}
