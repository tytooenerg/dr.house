import { useEffect, useState } from 'react';
import { api, ApiError } from '../../../lib/api';
import { Button } from '../../../components/ui/Button';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorState } from '../../../components/ui/ErrorState';
import { SelfServiceAgentCard } from '../../../components/agents/SelfServiceAgentCard';

interface AdminDispute {
  id: number;
  duplicataId: string;
  sacado: string;
  cedente: string;
  valorFmt: string;
  motivo: string;
  timeline: { autor: string; texto: string; quando: string }[];
}

export function DisputasPanel({ onCount }: { onCount?: (n: number) => void }) {
  const [disputes, setDisputes] = useState<AdminDispute[]>([]);
  const [noteById, setNoteById] = useState<Record<number, string>>({});
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadDisputes = () => {
    setLoadError(null);
    return api
      .get<{ disputes: AdminDispute[] }>('/admin/disputes')
      .then((d) => setDisputes(d.disputes))
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : 'Falha ao carregar as disputas em aberto.'));
  };

  useEffect(() => {
    loadDisputes();
  }, []);

  useEffect(() => {
    onCount?.(disputes.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disputes.length]);

  const arbitrate = async (id: number, decision: 'cedente' | 'sacado') => {
    const note = noteById[id]?.trim();
    if (!note) return;
    await api.post(`/admin/disputes/${id}/resolve`, { decision, note });
    loadDisputes();
  };

  return (
    <div className="flex flex-col gap-4">
      <SelfServiceAgentCard
        agentId="disputa_sinistro"
        title="Agente de Disputas & Sinistros"
        placeholder="Ex.: liste as disputas abertas e avalie a mais recente"
      />
      {loadError && <ErrorState message={loadError} onRetry={loadDisputes} />}
      {!loadError &&
        disputes.map((d) => (
        <div key={d.id} className="bg-white border border-border rounded-card p-6">
          <div className="flex justify-between items-start flex-wrap gap-2.5 mb-3">
            <div>
              <div className="font-mono-num font-bold text-[13px] text-textSecondary">{d.duplicataId}</div>
              <div className="font-bold text-[16px] mt-1">
                {d.cedente} vs {d.sacado} — {d.valorFmt}
              </div>
            </div>
          </div>
          <div className="rounded-[10px] px-4 py-3.5 mb-3 bg-amberBg text-sm">{d.motivo}</div>
          <div className="flex flex-col gap-2 mb-3.5">
            {d.timeline.map((t, i) => (
              <div key={i} className="text-[13px]">
                <b>{t.autor}</b> {t.texto} <span className="text-textMuted">— {t.quando}</span>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <input
              className="flex-1 min-w-[220px] px-3 py-2 rounded-md border border-inputBorder text-[13px]"
              placeholder="Nota da decisão de arbitragem"
              value={noteById[d.id] ?? ''}
              onChange={(e) => setNoteById((prev) => ({ ...prev, [d.id]: e.target.value }))}
            />
            <Button size="sm" variant="success" onClick={() => arbitrate(d.id, 'cedente')}>
              Decidir a favor do cedente
            </Button>
            <Button size="sm" variant="danger" onClick={() => arbitrate(d.id, 'sacado')}>
              Decidir a favor do sacado
            </Button>
          </div>
        </div>
      ))}
      {!loadError && disputes.length === 0 && (
        <div className="bg-white border border-border rounded-card">
          <EmptyState title="Nenhuma disputa em aberto" hint="Disputas escaladas pelo cedente aparecem aqui para arbitragem" />
        </div>
      )}
    </div>
  );
}
