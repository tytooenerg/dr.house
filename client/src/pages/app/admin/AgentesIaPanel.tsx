import { useEffect, useState } from 'react';
import { api, ApiError } from '../../../lib/api';
import { Button } from '../../../components/ui/Button';
import { EmptyState } from '../../../components/ui/EmptyState';

interface AgentToolSummary {
  name: string;
  description: string;
  sensitive: boolean;
}

interface AgentSummary {
  id: string;
  label: string;
  description: string;
  tools: AgentToolSummary[];
}

interface AgentStepView {
  type: string;
  toolName?: string | null;
  payload: unknown;
}

interface AgentRunOutcome {
  runId: number;
  mode: 'llm' | 'simulado';
  status: string;
  summary: string;
  steps: AgentStepView[];
  pendingActions: { id: number; toolName: string; input: unknown }[];
}

interface PendingActionRow {
  id: number;
  run_id: number;
  agent_id: string;
  tool_name: string;
  input: string;
  status: 'pendente' | 'aprovada' | 'rejeitada';
  created_at: string;
}

const STEP_LABELS: Record<string, string> = {
  assistente: 'Raciocínio do modelo',
  ferramenta: 'Ferramenta executada',
  erro_ferramenta: 'Erro na ferramenta',
  pendente_aprovacao: 'Aguardando aprovação humana',
  final: 'Conclusão',
  erro: 'Erro',
};

const STEP_COLOR: Record<string, string> = {
  assistente: '#5B6472',
  ferramenta: '#0A5C36',
  erro_ferramenta: '#B3261E',
  pendente_aprovacao: '#8A5A00',
  final: '#1E5EFF',
  erro: '#B3261E',
};

function renderPayload(payload: unknown): string {
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
function stepSummary(step: AgentStepView): string {
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

export function AgentesIaPanel() {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [llmEnabled, setLlmEnabled] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [actingUserId, setActingUserId] = useState('');
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState('');
  const [lastRun, setLastRun] = useState<AgentRunOutcome | null>(null);
  const [pending, setPending] = useState<PendingActionRow[]>([]);
  const [decidingId, setDecidingId] = useState<number | null>(null);

  const loadAgents = () => api.get<{ llmEnabled: boolean; agents: AgentSummary[] }>('/agents').then((d) => {
    setAgents(d.agents);
    setLlmEnabled(d.llmEnabled);
    setSelectedId((prev) => prev ?? d.agents[0]?.id ?? null);
  });
  const loadPending = () => api.get<{ pending: PendingActionRow[] }>('/agents/pending').then((d) => setPending(d.pending));

  useEffect(() => {
    loadAgents();
    loadPending();
  }, []);

  const selected = agents.find((a) => a.id === selectedId) ?? null;

  const runAgent = async () => {
    if (!selectedId || !input.trim()) return;
    setRunning(true);
    setRunError('');
    setLastRun(null);
    try {
      const body: Record<string, unknown> = { input: input.trim() };
      if (actingUserId.trim()) body.actingUserId = Number(actingUserId.trim());
      const outcome = await api.post<AgentRunOutcome>(`/agents/${selectedId}/run`, body);
      setLastRun(outcome);
      if (outcome.pendingActions.length > 0) await loadPending();
    } catch (err) {
      setRunError(err instanceof ApiError ? err.message : 'Falha ao executar o agente.');
    } finally {
      setRunning(false);
    }
  };

  const decide = async (id: number, action: 'approve' | 'reject') => {
    setDecidingId(id);
    try {
      await api.post(`/agents/pending/${id}/${action}`, {});
      await loadPending();
    } catch (err) {
      setRunError(err instanceof ApiError ? err.message : 'Falha ao decidir a ação pendente.');
    } finally {
      setDecidingId(null);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="text-textSecondary text-[12.5px]">
        Cada agente investiga dados reais da plataforma usando ferramentas (não é uma única chamada de texto) e decide os próximos passos sozinho.
        Ferramentas que escrevem algo com consequência real (dinheiro, decisão de compliance/KYB, registro jurídico/regulatório) nunca executam
        automaticamente — ficam como <strong>ação pendente</strong> abaixo até um admin aprovar ou rejeitar.
        {!llmEnabled && (
          <div className="mt-2 px-3 py-2 rounded-md bg-[#FBF1E0] text-[#8A5A00] font-bold text-[12px] w-fit">
            ANTHROPIC_API_KEY não configurado — os agentes rodam em modo simulado (não investigam nem agem de verdade).
          </div>
        )}
      </div>

      {pending.length > 0 && (
        <div className="bg-white border border-[#F1C889] rounded-card overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border font-bold text-[14px] bg-[#FBF1E0]">Ações pendentes de aprovação ({pending.length})</div>
          {pending.map((p) => (
            <div key={p.id} className="px-5 py-3.5 border-b border-[#F5F7FA] last:border-b-0 flex items-start justify-between gap-4">
              <div>
                <div className="font-bold text-[13px]">
                  {agents.find((a) => a.id === p.agent_id)?.label ?? p.agent_id} → <code>{p.tool_name}</code>
                </div>
                <pre className="mt-1 text-[11.5px] text-textSecondary whitespace-pre-wrap font-mono-num">{renderPayload(JSON.parse(p.input))}</pre>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button variant="secondary" disabled={decidingId === p.id} onClick={() => decide(p.id, 'reject')}>
                  Rejeitar
                </Button>
                <Button disabled={decidingId === p.id} onClick={() => decide(p.id, 'approve')}>
                  Aprovar e executar
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-4" style={{ gridTemplateColumns: '280px 1fr' }}>
        <div className="flex flex-col gap-2">
          {agents.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => {
                setSelectedId(a.id);
                setLastRun(null);
                setRunError('');
              }}
              className="text-left px-3.5 py-3 rounded-card border cursor-pointer"
              style={{
                background: selectedId === a.id ? '#0B1F3A' : '#fff',
                color: selectedId === a.id ? '#fff' : '#0B1F3A',
                borderColor: selectedId === a.id ? '#0B1F3A' : '#E4E8EE',
              }}
            >
              <div className="font-bold text-[13px]">{a.label}</div>
              <div className="text-[11.5px] mt-0.5" style={{ color: selectedId === a.id ? '#C7D0E0' : '#5B6472' }}>
                {a.tools.length} ferramenta(s) · {a.tools.filter((t) => t.sensitive).length} sensível(is)
              </div>
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-4">
          {!selected ? (
            <EmptyState title="Nenhum agente selecionado" hint="Escolha um agente à esquerda." />
          ) : (
            <>
              <div className="bg-white border border-border rounded-card p-5">
                <div className="font-bold text-[15px] mb-1">{selected.label}</div>
                <div className="text-textSecondary text-[12.5px] mb-4">{selected.description}</div>

                <div className="flex flex-wrap gap-1.5 mb-4">
                  {selected.tools.map((t) => (
                    <span
                      key={t.name}
                      title={t.description}
                      className="px-2 py-1 rounded-md text-[11px] font-bold"
                      style={{ background: t.sensitive ? '#F7E9E7' : '#EAF3EE', color: t.sensitive ? '#B3261E' : '#0A5C36' }}
                    >
                      {t.name}
                      {t.sensitive ? ' (sensível)' : ''}
                    </span>
                  ))}
                </div>

                <label className="block text-[11.5px] font-bold text-textTertiary uppercase mb-1.5">Instrução para o agente</label>
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  rows={3}
                  placeholder="Ex: investigue o risco do sacado CNPJ 11.222.333/0001-44 e recomende se posso emprestar contra as duplicatas dele"
                  className="w-full border border-border rounded-md px-3 py-2 text-[13px] mb-3"
                />
                <label className="block text-[11.5px] font-bold text-textTertiary uppercase mb-1.5">
                  Executar em nome de (userId, opcional — padrão: sua própria conta admin)
                </label>
                <input
                  value={actingUserId}
                  onChange={(e) => setActingUserId(e.target.value)}
                  placeholder="Ex: 4"
                  className="w-full border border-border rounded-md px-3 py-2 text-[13px] mb-4"
                />
                <Button onClick={runAgent} disabled={running || !input.trim()}>
                  {running ? 'Executando…' : 'Executar agente'}
                </Button>
                {runError && <div className="text-red text-[12.5px] mt-2">{runError}</div>}
              </div>

              {lastRun && (
                <div className="bg-white border border-border rounded-card overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
                    <span className="font-bold text-[14px]">Execução #{lastRun.runId}</span>
                    <span
                      className="px-2.5 py-1 rounded-full text-[11px] font-bold"
                      style={{
                        background: lastRun.status === 'concluido' ? '#EAF3EE' : lastRun.status === 'simulado' ? '#F0F2F5' : '#FBF1E0',
                        color: lastRun.status === 'concluido' ? '#0A5C36' : lastRun.status === 'simulado' ? '#5B6472' : '#8A5A00',
                      }}
                    >
                      {lastRun.mode === 'simulado' ? 'simulado' : lastRun.status}
                    </span>
                  </div>
                  <div className="px-5 py-4 flex flex-col gap-3">
                    {lastRun.steps.map((s, i) => (
                      <div key={i} className="border-l-2 pl-3" style={{ borderColor: STEP_COLOR[s.type] ?? '#E4E8EE' }}>
                        <div className="text-[11px] font-bold uppercase" style={{ color: STEP_COLOR[s.type] ?? '#5B6472' }}>
                          {STEP_LABELS[s.type] ?? s.type}
                          {s.toolName ? ` — ${s.toolName}` : ''}
                        </div>
                        <div className="text-[12.5px] text-textPrimary whitespace-pre-wrap mt-0.5">{stepSummary(s)}</div>
                      </div>
                    ))}
                    {lastRun.steps.length === 0 && <div className="text-textSecondary text-[12.5px]">{lastRun.summary}</div>}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
