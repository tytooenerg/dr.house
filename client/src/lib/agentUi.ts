// Shared between the admin "Agentes IA" console (AgentesIaPanel) and the self-service
// widgets embedded in Emitir/Automação (SelfServiceAgentCard) — same run/step/pending
// shapes returned by routes/agents.ts, same rendering rules for a step trace.

export interface AgentToolSummary {
  name: string;
  description: string;
  sensitive: boolean;
  selfApprovable: boolean;
}

export interface AgentSummary {
  id: string;
  label: string;
  description: string;
  selfService: boolean;
  tools: AgentToolSummary[];
}

export interface AgentStepView {
  type: string;
  toolName?: string | null;
  payload: unknown;
}

export interface AgentRunOutcome {
  runId: number;
  mode: 'llm' | 'simulado';
  status: string;
  summary: string;
  steps: AgentStepView[];
  pendingActions: { id: number; toolName: string; input: unknown }[];
}

export interface PendingActionRow {
  id: number;
  run_id: number;
  agent_id: string;
  tool_name: string;
  input: string;
  status: 'pendente' | 'aprovada' | 'rejeitada';
  created_at: string;
}

export const STEP_LABELS: Record<string, string> = {
  assistente: 'Raciocínio do modelo',
  ferramenta: 'Ferramenta executada',
  erro_ferramenta: 'Erro na ferramenta',
  pendente_aprovacao: 'Aguardando aprovação',
  final: 'Conclusão',
  erro: 'Erro',
};

export const STEP_COLOR: Record<string, string> = {
  assistente: '#5B6472',
  ferramenta: '#0A5C36',
  erro_ferramenta: '#B3261E',
  pendente_aprovacao: '#8A5A00',
  final: '#1E5EFF',
  erro: '#B3261E',
};

export function renderPayload(payload: unknown): string {
  if (payload == null) return '—';
  if (typeof payload === 'string') return payload;
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

// A step's payload can be the raw Anthropic content-block array (assistant turns include
// text + tool_use blocks) or a plain {input, output} tool-call record — this pulls
// whatever text is human-readable out of either shape instead of dumping raw JSON when a
// short line will do.
export function stepSummary(step: AgentStepView): string {
  if (step.type === 'assistente' && Array.isArray(step.payload)) {
    const text = (step.payload as { type: string; text?: string; name?: string }[])
      .map((b) => (b.type === 'text' ? b.text : b.type === 'tool_use' ? `→ chamando ${b.name}` : null))
      .filter(Boolean)
      .join(' ');
    return text || '(sem texto)';
  }
  if (step.type === 'final' && typeof step.payload === 'object' && step.payload && 'text' in (step.payload as Record<string, unknown>)) {
    return String((step.payload as { text: string }).text);
  }
  return renderPayload(step.payload);
}
