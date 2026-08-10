import type Anthropic from '@anthropic-ai/sdk';
import { askClaudeWithTools, claudeEnabled } from './claude.js';
import { logger } from './logger.js';
import { addAgentStep, createAgentRun, createPendingAction, finishAgentRun, listAgentRunsForSubject } from '../db/agents.js';
import { isAgentEnabled, isAgentOverBudget, getAgentDailyBudgetUsd, getDualApprovalThresholdBrl } from './agentGovernance.js';
import type { Role } from '../db/types.js';

// The agentic layer: every other AI feature in this codebase (chat, NF-e extraction, risk
// narrative, dispute copilot, etc — see lib/claude.ts) is one prompt in, one answer out.
// An "agent" here is different — it gets a real tool belt (functions that read or write
// actual Lastro data) and a loop: propose a tool call, execute it, see the result, decide
// the next step, repeat, until it has enough to give a final answer or it hits the step
// limit. That loop is what "agentic" means; this file is the one place it's implemented,
// shared by all 10 agents in lib/agents/*.

export interface AgentRunContext {
  runId: number;
  userId?: number;
  subjectType?: string;
  subjectId?: string;
  // How many agent-to-agent handoffs deep this run is (0 = a top-level run). Only a
  // top-level run may hand off (see createHandoffTool) — a run that itself resulted from a
  // handoff cannot hand off again, a simple, hard guard against a handoff loop.
  handoffDepth?: number;
}

export interface AgentToolDef<TInput = any> {
  name: string;
  description: string;
  // Plain JSON Schema object, e.g. { type: 'object', properties: {...}, required: [...] }
  inputSchema: Record<string, unknown>;
  // A sensitive tool NEVER executes automatically, no matter how confident the model is.
  // The runtime parks the call as a pending action instead — a human has to approve it via
  // POST /api/agents/pending/:id/approve before the handler actually runs. This is the one
  // hard line in the whole system between "the agent investigated and recommended" and
  // "the agent did something" — reserved for anything that moves money, changes a
  // compliance/KYB decision, or creates an official legal/regulatory record.
  sensitive?: boolean;
  // Only meaningful on a sensitive tool. A self-service run (see AgentDefinition.selfServiceRoles)
  // is always scoped to the acting user's own account (ctx.userId is forced server-side —
  // see routes/agents.ts), so approving a selfApprovable tool is the agentic equivalent of
  // an action that user could already take unassisted through the normal UI (emitting a
  // duplicata themselves, clicking "Comprar" themselves) — the runtime lets the acting user
  // approve/reject their own pending action instead of requiring an admin. Every other
  // sensitive tool (a compliance/KYB decision, a legal escalation, anything about someone
  // else's account) stays admin-only no matter what.
  selfApprovable?: boolean;
  // Only meaningful on a sensitive tool. Resolves the real BRL value the proposed action
  // would move (e.g. the emission's valor, the offer being bought) — governance
  // (lib/agentGovernance.ts) compares it to the configured dual-approval threshold to
  // decide whether this pending action needs one admin's approval or two. A tool without
  // this always needs just one (its "value" isn't a single number — a KYB decision, a
  // legal escalation). Errors/nulls fall back to requiring only one approval rather than
  // blocking the action outright — governance narrows what's auto-approved, it never
  // itself becomes a new way to fail closed on a wrong guess.
  extractValueBRL?: (input: TInput, ctx: AgentRunContext) => Promise<number | null>;
  handler: (input: TInput, ctx: AgentRunContext) => Promise<unknown>;
}

export interface AgentDefinition {
  id: string;
  label: string;
  description: string;
  systemPrompt: string;
  tools: AgentToolDef[];
  maxSteps?: number;
  // Roles (besides admin, who can always run every agent) allowed to run this agent
  // themselves — always forced to act on their own account, never another user's. Absent
  // means admin-only, same as before this field existed.
  selfServiceRoles?: Role[];
}

export interface AgentRunStepView {
  type: string;
  toolName?: string | null;
  payload: unknown;
}

export interface AgentRunOutcome {
  runId: number;
  mode: 'llm' | 'simulado';
  status: 'concluido' | 'limite_de_passos' | 'erro' | 'simulado' | 'desabilitado' | 'orcamento_excedido';
  summary: string;
  steps: AgentRunStepView[];
  pendingActions: { id: number; toolName: string; input: unknown }[];
}

const DEFAULT_MAX_STEPS = 8;

export interface RunAgentOptions {
  input: string;
  userId?: number;
  subjectType?: string;
  subjectId?: string;
  handoffDepth?: number;
}

// Cross-agent memory: every prior *completed* run against the same real-world subject
// (subjectType/subjectId — e.g. a duplicataId, a userId), regardless of which agent
// produced it, gets folded into the system prompt as reference context. A cobrança run on
// a duplicata the underwriting agent already investigated doesn't start blind — it's told
// what was already found, though it's still instructed to verify current data rather than
// trust old context blindly (state changes: a duplicata that was clean yesterday can be
// flagged today).
async function buildPriorContext(subjectType: string | undefined, subjectId: string | undefined, excludeRunId: number): Promise<string> {
  if (!subjectType || !subjectId) return '';
  const prior = listAgentRunsForSubject(subjectType, subjectId, 5).filter((r) => r.id !== excludeRunId && r.summary);
  if (prior.length === 0) return '';
  const lines = prior.map((r) => `- [agente ${r.agent_id}, ${r.created_at}] ${r.summary}`).join('\n');
  return `\n\n---\nContexto de investigações anteriores de outros agentes sobre este mesmo caso (${subjectType}=${subjectId}) — use como referência, mas confirme dados atuais via ferramentas quando relevante, pois o estado pode ter mudado:\n${lines}`;
}

const MAX_HANDOFF_DEPTH = 1;

// Lazily injected by lib/agents/index.ts once every agent is defined — avoids a circular
// import (agentRuntime.ts would otherwise have to import agents/index.ts, which imports
// every agent file, which imports agentRuntime.ts for the AgentDefinition type). The
// handoff tool's handler only reads this at call time, long after the whole module graph
// has finished loading.
let agentRegistry: Record<string, AgentDefinition> | null = null;
export function registerAgentRegistry(registry: Record<string, AgentDefinition>) {
  agentRegistry = registry;
}

// Factory for a generic "call another agent" tool — attach it to an agent's `tools` array
// wherever a real handoff makes sense (e.g. Emissão handing an uncertain case to
// Underwriting). Never sensitive itself: it doesn't write anything on its own, it just
// runs another agent's own loop, which enforces its own sensitive/governance rules exactly
// as if it had been invoked directly.
export function createHandoffTool(callableAgentIds: string[]): AgentToolDef<{ agentId: string; instrucao: string }> {
  return {
    name: 'acionar_agente',
    description: `Aciona outro agente da Lastro para investigar algo fora do escopo deste, repassando o contexto necessário. Agentes disponíveis para acionar: ${callableAgentIds.join(', ')}. Use apenas quando a investigação realmente precisar da especialidade do outro agente.`,
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', enum: callableAgentIds },
        instrucao: { type: 'string', description: 'O que o outro agente deve investigar, com todo o contexto necessário (ele não vê esta conversa).' },
      },
      required: ['agentId', 'instrucao'],
    },
    handler: async (input, ctx) => {
      const depth = ctx.handoffDepth ?? 0;
      if (depth >= MAX_HANDOFF_DEPTH) return { erro: 'Profundidade máxima de encadeamento de agentes atingida — investigue diretamente com as ferramentas disponíveis.' };
      if (!agentRegistry) return { erro: 'Registro de agentes indisponível.' };
      const target = agentRegistry[input.agentId];
      if (!target || !callableAgentIds.includes(input.agentId)) return { erro: `Agente "${input.agentId}" não pode ser acionado a partir daqui.` };
      const outcome = await runAgent(target, {
        input: input.instrucao,
        userId: ctx.userId,
        subjectType: ctx.subjectType,
        subjectId: ctx.subjectId,
        handoffDepth: depth + 1,
      });
      return { agenteAcionado: input.agentId, runId: outcome.runId, status: outcome.status, resumo: outcome.summary, acoesPendentesCriadas: outcome.pendingActions.length };
    },
  };
}

export async function runAgent(def: AgentDefinition, opts: RunAgentOptions): Promise<AgentRunOutcome> {
  // Governance gates — checked before any run row is even created, no cost incurred
  // either way. A disabled agent (admin kill switch) or one that already spent its
  // configured daily budget refuses outright instead of degrading silently.
  if (!isAgentEnabled(def.id)) {
    const runId = createAgentRun({ agentId: def.id, userId: opts.userId ?? null, subjectType: opts.subjectType ?? null, subjectId: opts.subjectId ?? null, input: opts.input, mode: 'simulado' });
    const summary = `Agente "${def.label}" está desabilitado por um admin — nenhuma execução foi realizada.`;
    finishAgentRun(runId, 'simulado', summary);
    return { runId, mode: 'simulado', status: 'desabilitado', summary, steps: [], pendingActions: [] };
  }
  if (isAgentOverBudget(def.id)) {
    const runId = createAgentRun({ agentId: def.id, userId: opts.userId ?? null, subjectType: opts.subjectType ?? null, subjectId: opts.subjectId ?? null, input: opts.input, mode: 'simulado' });
    const budget = getAgentDailyBudgetUsd(def.id);
    const summary = `Agente "${def.label}" atingiu o orçamento diário configurado (US$ ${budget?.toFixed(2)}) — execução recusada até a virada do dia ou aumento do orçamento.`;
    finishAgentRun(runId, 'simulado', summary);
    return { runId, mode: 'simulado', status: 'orcamento_excedido', summary, steps: [], pendingActions: [] };
  }

  const runId = createAgentRun({
    agentId: def.id,
    userId: opts.userId ?? null,
    subjectType: opts.subjectType ?? null,
    subjectId: opts.subjectId ?? null,
    input: opts.input,
    mode: claudeEnabled ? 'llm' : 'simulado',
  });

  // Real-when-configured, same as every other AI feature here: without ANTHROPIC_API_KEY
  // this agent does NOT pretend to reason or silently run tools on a fixed script — it
  // stops and says so, honestly, exactly like askClaude() returning null does everywhere
  // else in this codebase.
  if (!claudeEnabled) {
    const summary = `Modo simulado — configure ANTHROPIC_API_KEY para o agente "${def.label}" investigar e agir de verdade sobre este caso. Nenhuma ferramenta foi executada.`;
    finishAgentRun(runId, 'simulado', summary);
    return { runId, mode: 'simulado', status: 'simulado', summary, steps: [], pendingActions: [] };
  }

  const tools: Anthropic.Tool[] = def.tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
  }));
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: opts.input }];
  const maxSteps = def.maxSteps ?? DEFAULT_MAX_STEPS;
  const steps: AgentRunStepView[] = [];
  const pendingActions: AgentRunOutcome['pendingActions'] = [];
  const ctx: AgentRunContext = {
    runId,
    userId: opts.userId,
    subjectType: opts.subjectType,
    subjectId: opts.subjectId,
    handoffDepth: opts.handoffDepth ?? 0,
  };
  const system = def.systemPrompt + (await buildPriorContext(opts.subjectType, opts.subjectId, runId));

  for (let step = 0; step < maxSteps; step++) {
    const message = await askClaudeWithTools({
      system,
      messages,
      tools,
      maxTokens: 1500,
      meta: { feature: `agent_${def.id}`, userId: opts.userId },
    });

    if (!message) {
      const summary = 'Falha ao chamar o modelo — execução do agente interrompida.';
      addAgentStep(runId, step, 'erro', null, { error: summary });
      finishAgentRun(runId, 'erro', summary);
      return { runId, mode: 'llm', status: 'erro', summary, steps, pendingActions };
    }

    messages.push({ role: 'assistant', content: message.content });
    addAgentStep(runId, step, 'assistente', null, message.content);
    steps.push({ type: 'assistente', payload: message.content });

    if (message.stop_reason !== 'tool_use') {
      const finalText = message.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text ?? '(sem texto final)';
      addAgentStep(runId, step, 'final', null, { text: finalText });
      steps.push({ type: 'final', payload: finalText });
      finishAgentRun(runId, 'concluido', finalText);
      return { runId, mode: 'llm', status: 'concluido', summary: finalText, steps, pendingActions };
    }

    const toolUseBlocks = message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    const resultBlocks: Anthropic.ToolResultBlockParam[] = [];

    for (const block of toolUseBlocks) {
      const toolDef = def.tools.find((t) => t.name === block.name);
      if (!toolDef) {
        resultBlocks.push({ type: 'tool_result', tool_use_id: block.id, content: `Ferramenta desconhecida: ${block.name}`, is_error: true });
        continue;
      }

      if (toolDef.sensitive) {
        let approvalsRequired = 1;
        if (toolDef.extractValueBRL) {
          try {
            const value = await toolDef.extractValueBRL(block.input, ctx);
            if (value !== null && value >= getDualApprovalThresholdBrl()) approvalsRequired = 2;
          } catch (err) {
            logger.warn({ err, tool: block.name, agent: def.id }, '[agent] falha ao calcular valor da ação para governança — seguindo com aprovação única');
          }
        }
        const pendingId = createPendingAction({ runId, agentId: def.id, toolName: block.name, input: block.input, approvalsRequired });
        pendingActions.push({ id: pendingId, toolName: block.name, input: block.input });
        addAgentStep(runId, step, 'pendente_aprovacao', block.name, { input: block.input, pendingActionId: pendingId });
        steps.push({ type: 'pendente_aprovacao', toolName: block.name, payload: { input: block.input, pendingActionId: pendingId } });
        resultBlocks.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify({ status: 'aguardando_aprovacao_humana', pendingActionId: pendingId }),
        });
        continue;
      }

      try {
        const output = await toolDef.handler(block.input, ctx);
        addAgentStep(runId, step, 'ferramenta', block.name, { input: block.input, output });
        steps.push({ type: 'ferramenta', toolName: block.name, payload: { input: block.input, output } });
        resultBlocks.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(output ?? null) });
      } catch (err) {
        logger.warn({ err, tool: block.name, agent: def.id }, '[agent] falha ao executar ferramenta');
        addAgentStep(runId, step, 'erro_ferramenta', block.name, { input: block.input, error: String(err) });
        steps.push({ type: 'erro_ferramenta', toolName: block.name, payload: { input: block.input, error: String(err) } });
        resultBlocks.push({ type: 'tool_result', tool_use_id: block.id, content: `Erro ao executar: ${String(err)}`, is_error: true });
      }
    }

    messages.push({ role: 'user', content: resultBlocks });
  }

  const summary = `Limite de ${maxSteps} passos atingido sem conclusão — revise manualmente.`;
  finishAgentRun(runId, 'limite_de_passos', summary);
  return { runId, mode: 'llm', status: 'limite_de_passos', summary, steps, pendingActions };
}

// Used by routes/agents.ts when a human approves a previously-parked sensitive action —
// runs the exact same handler the agent would have run, with the exact input it proposed,
// nothing re-negotiated. Rejection never calls this at all.
export async function executeApprovedTool(def: AgentDefinition, toolName: string, input: unknown, ctx: AgentRunContext): Promise<unknown> {
  const toolDef = def.tools.find((t) => t.name === toolName);
  if (!toolDef) throw new Error(`Ferramenta desconhecida: ${toolName}`);
  return toolDef.handler(input, ctx);
}
