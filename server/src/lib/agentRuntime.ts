import type Anthropic from '@anthropic-ai/sdk';
import { askClaudeWithTools, claudeEnabled } from './claude.js';
import { logger } from './logger.js';
import { addAgentStep, createAgentRun, createPendingAction, finishAgentRun } from '../db/agents.js';
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
  status: 'concluido' | 'limite_de_passos' | 'erro' | 'simulado';
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
}

export async function runAgent(def: AgentDefinition, opts: RunAgentOptions): Promise<AgentRunOutcome> {
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
  const ctx: AgentRunContext = { runId, userId: opts.userId };

  for (let step = 0; step < maxSteps; step++) {
    const message = await askClaudeWithTools({
      system: def.systemPrompt,
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
        const pendingId = createPendingAction({ runId, agentId: def.id, toolName: block.name, input: block.input });
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
