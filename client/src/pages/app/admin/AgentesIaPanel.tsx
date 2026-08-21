import { useEffect, useState } from 'react';
import { api, ApiError } from '../../../lib/api';
import { Button } from '../../../components/ui/Button';
import { EmptyState } from '../../../components/ui/EmptyState';
import {
  type AgentSummary,
  type AgentRunOutcome,
  type PendingActionRow,
  type AgentGovernanceEntry,
  STEP_LABELS,
  STEP_COLOR,
  renderPayload,
  stepSummary,
} from '../../../lib/agentUi';

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
  const [bulkApproving, setBulkApproving] = useState(false);
  const [showGovernance, setShowGovernance] = useState(false);
  const [governance, setGovernance] = useState<{ dualApprovalThresholdBrl: number; agents: AgentGovernanceEntry[] } | null>(null);
  const [thresholdInput, setThresholdInput] = useState('');
  const [budgetInputs, setBudgetInputs] = useState<Record<string, string>>({});
  const [savingGov, setSavingGov] = useState<string | null>(null);

  const loadAgents = () => api.get<{ llmEnabled: boolean; agents: AgentSummary[] }>('/agents').then((d) => {
    setAgents(d.agents);
    setLlmEnabled(d.llmEnabled);
    setSelectedId((prev) => prev ?? d.agents[0]?.id ?? null);
  });
  const loadPending = () => api.get<{ pending: PendingActionRow[] }>('/agents/pending').then((d) => setPending(d.pending));
  const loadGovernance = () =>
    api.get<{ dualApprovalThresholdBrl: number; agents: AgentGovernanceEntry[] }>('/agents/governance').then((d) => {
      setGovernance(d);
      setThresholdInput(String(d.dualApprovalThresholdBrl));
      setBudgetInputs(Object.fromEntries(d.agents.map((a) => [a.id, a.dailyBudgetUsd === null ? '' : String(a.dailyBudgetUsd)])));
    });

  useEffect(() => {
    loadAgents();
    loadPending();
    loadGovernance();
  }, []);

  const toggleAgentEnabled = async (agentId: string, enabled: boolean) => {
    setSavingGov(agentId);
    try {
      await api.put(`/agents/governance/${agentId}`, { enabled });
      await loadGovernance();
    } finally {
      setSavingGov(null);
    }
  };

  const saveBudget = async (agentId: string) => {
    setSavingGov(agentId);
    try {
      const raw = budgetInputs[agentId]?.trim() ?? '';
      await api.put(`/agents/governance/${agentId}`, { dailyBudgetUsd: raw === '' ? null : Number(raw) });
      await loadGovernance();
    } finally {
      setSavingGov(null);
    }
  };

  const saveThreshold = async () => {
    const n = Number(thresholdInput.replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) return;
    setSavingGov('__threshold');
    try {
      await api.put('/agents/governance/dual-approval-threshold', { thresholdBrl: n });
      await loadGovernance();
    } finally {
      setSavingGov(null);
    }
  };

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

  // Still one explicit human click per execution under the hood (see the route's own
  // comment) — this just fires all of them from a single button instead of clicking
  // "Aprovar e executar" once per row on an otherwise-obviously-clean queue.
  const approveAllPending = async () => {
    setBulkApproving(true);
    try {
      await api.post<{ total: number; sucesso: number; resultados: { id: number; ok: boolean; error?: string }[] }>('/agents/pending/approve-bulk', {
        ids: pending.map((p) => p.id),
      });
      await loadPending();
    } catch (err) {
      setRunError(err instanceof ApiError ? err.message : 'Falha ao aprovar em lote.');
    } finally {
      setBulkApproving(false);
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

      <div>
        <button type="button" onClick={() => setShowGovernance((v) => !v)} className="text-[12.5px] font-bold text-blue bg-transparent border-none cursor-pointer px-0">
          {showGovernance ? '▾' : '▸'} Governança dos agentes (kill switch, orçamento, dupla aprovação)
        </button>
        {showGovernance && governance && (
          <div className="bg-white border border-border rounded-card mt-2.5 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border flex items-center gap-2.5 flex-wrap">
              <span className="font-bold text-[13px]">Valor mínimo para exigir 2 aprovadores (BRL)</span>
              <input value={thresholdInput} onChange={(e) => setThresholdInput(e.target.value)} className="w-32 px-2.5 py-1.5 rounded-md border border-border text-[12.5px]" />
              <Button size="sm" variant="secondary" disabled={savingGov === '__threshold'} onClick={saveThreshold}>
                Salvar
              </Button>
            </div>
            {governance.agents.map((g) => (
              <div key={g.id} className="px-5 py-3 border-b border-[#F5F7FA] last:border-b-0 flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    disabled={savingGov === g.id}
                    onClick={() => toggleAgentEnabled(g.id, !g.enabled)}
                    className="px-2.5 py-1 rounded-md text-[11px] font-bold cursor-pointer border-none"
                    style={{ background: g.enabled ? '#EAF3EE' : '#F7E9E7', color: g.enabled ? '#0A5C36' : '#B3261E' }}
                  >
                    {g.enabled ? 'Ativo' : 'Desativado'}
                  </button>
                  <span className="text-[12.5px] font-bold">{agents.find((a) => a.id === g.id)?.label ?? g.id}</span>
                  <span className="text-[11.5px] text-textTertiary">gasto hoje: US$ {g.spentTodayUsd.toFixed(3)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11.5px] text-textSecondary">Orçamento diário (US$, vazio = ilimitado)</span>
                  <input
                    value={budgetInputs[g.id] ?? ''}
                    onChange={(e) => setBudgetInputs((prev) => ({ ...prev, [g.id]: e.target.value }))}
                    placeholder="ilimitado"
                    className="w-24 px-2.5 py-1.5 rounded-md border border-border text-[12.5px]"
                  />
                  <Button size="sm" variant="secondary" disabled={savingGov === g.id} onClick={() => saveBudget(g.id)}>
                    Salvar
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {pending.length > 0 && (
        <div className="bg-white border border-[#F1C889] rounded-card overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border font-bold text-[14px] bg-[#FBF1E0] flex items-center justify-between gap-3 flex-wrap">
            <span>Ações pendentes de aprovação ({pending.length})</span>
            {pending.length > 1 && (
              <Button size="sm" variant="secondary" disabled={bulkApproving} onClick={approveAllPending}>
                {bulkApproving ? 'Aprovando…' : `Aprovar todas (${pending.length})`}
              </Button>
            )}
          </div>
          {pending.map((p) => (
            <div key={p.id} className="px-5 py-3.5 border-b border-[#F5F7FA] last:border-b-0 flex items-start justify-between gap-4">
              <div>
                <div className="font-bold text-[13px] flex items-center gap-2">
                  {agents.find((a) => a.id === p.agent_id)?.label ?? p.agent_id} → <code>{p.tool_name}</code>
                  {p.approvals_required > 1 && (
                    <span className="px-2 py-0.5 rounded-md text-[10.5px] font-bold bg-[#FBF1E0] text-[#8A5A00]">requer {p.approvals_required} aprovadores</span>
                  )}
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
