import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { STEP_LABELS, STEP_COLOR, stepSummary, type AgentRunOutcome, type AgentSummary, type PendingActionRow } from '../../lib/agentUi';

// Embedded, single-agent version of the admin "Agentes IA" console — no agent picker, no
// "run as another user" field, because self-service is always scoped to the caller's own
// account server-side (routes/agents.ts forces it regardless of what this UI sends). A
// pending action created here can be approved right here too, since it mirrors something
// the user could already do unassisted (emitir_duplicata, comprar_oferta) — see
// AgentToolDef.selfApprovable.
export function SelfServiceAgentCard({ agentId, title, placeholder }: { agentId: string; title: string; placeholder: string }) {
  const [agent, setAgent] = useState<AgentSummary | null>(null);
  const [llmEnabled, setLlmEnabled] = useState(false);
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [lastRun, setLastRun] = useState<AgentRunOutcome | null>(null);
  const [pending, setPending] = useState<PendingActionRow[]>([]);
  const [decidingId, setDecidingId] = useState<number | null>(null);

  const loadPending = () =>
    api.get<{ pending: PendingActionRow[] }>('/agents/pending').then((d) => setPending(d.pending.filter((p) => p.agent_id === agentId)));

  useEffect(() => {
    api.get<{ llmEnabled: boolean; agents: AgentSummary[] }>('/agents').then((d) => {
      setLlmEnabled(d.llmEnabled);
      setAgent(d.agents.find((a) => a.id === agentId) ?? null);
    });
    loadPending();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  if (!agent) return null;

  const run = async () => {
    if (!input.trim()) return;
    setRunning(true);
    setError('');
    setLastRun(null);
    try {
      const outcome = await api.post<AgentRunOutcome>(`/agents/${agentId}/run`, { input: input.trim() });
      setLastRun(outcome);
      if (outcome.pendingActions.length > 0) await loadPending();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao executar o agente.');
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
      setError(err instanceof ApiError ? err.message : 'Falha ao decidir.');
    } finally {
      setDecidingId(null);
    }
  };

  return (
    <Card className="p-6 flex flex-col gap-3.5">
      <div>
        <div className="font-bold text-[14.5px] flex items-center gap-2">
          {title}
          <span className="px-2 py-0.5 rounded-md text-[10.5px] font-bold bg-[#EEF3FF] text-blue">IA agêntica</span>
        </div>
        <div className="text-textSecondary text-[12.5px] mt-1">{agent.description}</div>
        {!llmEnabled && <div className="text-[11.5px] font-bold text-[#8A5A00] mt-1.5">Modo simulado — peça ao admin para configurar a IA.</div>}
      </div>

      {pending.length > 0 && (
        <div className="flex flex-col gap-2">
          {pending.map((p) => (
            <div key={p.id} className="p-3 rounded-lg bg-[#FBF1E0] flex items-start justify-between gap-3">
              <div>
                <div className="font-bold text-[12.5px]">Aguardando sua confirmação — {p.tool_name}</div>
                <pre className="text-[11px] text-textSecondary whitespace-pre-wrap mt-1">{renderPayloadShort(p.input)}</pre>
              </div>
              <div className="flex gap-1.5 shrink-0">
                <Button size="sm" variant="secondary" disabled={decidingId === p.id} onClick={() => decide(p.id, 'reject')}>
                  Descartar
                </Button>
                <Button size="sm" disabled={decidingId === p.id} onClick={() => decide(p.id, 'approve')}>
                  Confirmar
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        rows={2}
        placeholder={placeholder}
        className="w-full border border-border rounded-md px-3 py-2 text-[13px]"
      />
      <Button onClick={run} disabled={running || !input.trim()} variant="secondary">
        {running ? 'Investigando…' : 'Pedir para a IA investigar'}
      </Button>
      {error && <div className="text-red text-[12px]">{error}</div>}

      {lastRun && (
        <div className="flex flex-col gap-2.5 border-t border-hairline pt-3">
          {lastRun.steps.map((s, i) => (
            <div key={i} className="border-l-2 pl-2.5" style={{ borderColor: STEP_COLOR[s.type] ?? '#E4E8EE' }}>
              <div className="text-[10.5px] font-bold uppercase" style={{ color: STEP_COLOR[s.type] ?? '#5B6472' }}>
                {STEP_LABELS[s.type] ?? s.type}
                {s.toolName ? ` — ${s.toolName}` : ''}
              </div>
              <div className="text-[12px] whitespace-pre-wrap mt-0.5">{stepSummary(s)}</div>
            </div>
          ))}
          {lastRun.steps.length === 0 && <div className="text-textSecondary text-[12px]">{lastRun.summary}</div>}
        </div>
      )}
    </Card>
  );
}

function renderPayloadShort(json: string): string {
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return json;
  }
}
