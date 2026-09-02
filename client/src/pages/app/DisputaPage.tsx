import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { PageHeader } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';

interface Dispute {
  id: number;
  duplicataId: string;
  sacado: string;
  valorFmt: string;
  motivo: string;
  timeline: { autor: string; texto: string; quando: string }[];
  isSending: boolean;
  isSent: boolean;
  canSend: boolean;
}

export function DisputaPage() {
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [resolvingId, setResolvingId] = useState<number | null>(null);
  const [errorById, setErrorById] = useState<Record<number, string>>({});

  const load = () => api.get<{ disputes: Dispute[] }>('/disputas').then((d) => setDisputes(d.disputes));

  useEffect(() => {
    load();
  }, []);

  const sendEvidence = async (id: number) => {
    setErrorById((prev) => ({ ...prev, [id]: '' }));
    setDisputes((prev) => prev.map((d) => (d.id === id ? { ...d, isSending: true, canSend: false } : d)));
    try {
      const data = await api.post<{ disputes: Dispute[] }>(`/disputas/${id}/evidence`);
      setDisputes(data.disputes);
    } catch (err) {
      // Revert the optimistic "sending" state so the button reappears and the person can
      // try again — a failed request must never leave the UI stuck on "Enviando…" forever.
      setDisputes((prev) => prev.map((d) => (d.id === id ? { ...d, isSending: false, canSend: true } : d)));
      setErrorById((prev) => ({ ...prev, [id]: err instanceof ApiError ? err.message : 'Não foi possível enviar a evidência agora — tente de novo.' }));
    }
  };

  const resolve = async (id: number) => {
    setErrorById((prev) => ({ ...prev, [id]: '' }));
    setResolvingId(id);
    try {
      const data = await api.post<{ disputes: Dispute[] }>(`/disputas/${id}/resolve`, { outcome: 'aceita' });
      setDisputes(data.disputes);
    } catch (err) {
      setErrorById((prev) => ({ ...prev, [id]: err instanceof ApiError ? err.message : 'Não foi possível resolver a disputa agora — tente de novo.' }));
    } finally {
      setResolvingId(null);
    }
  };

  return (
    <div>
      <PageHeader title="Resolução de Disputas" subtitle="Duplicatas contestadas pelo sacado — envie evidências e chegue a um acordo antes de escalar ao Banco Central" />

      <div className="flex flex-col gap-4">
        {disputes.map((d) => (
          <div key={d.id} className="bg-white rounded-card p-6" style={{ border: '1px solid #E9CFCB' }}>
            <div className="flex justify-between items-start mb-4 flex-wrap gap-2.5">
              <div>
                <div className="font-mono-num font-bold text-[13px] text-textSecondary">{d.duplicataId}</div>
                <div className="font-bold text-[17px] mt-1">
                  {d.sacado} — {d.valorFmt}
                </div>
              </div>
              <span className="text-[11.5px] font-bold px-3 py-1.5 rounded-md bg-redBg text-red">Contestada</span>
            </div>

            <div className="rounded-[10px] px-4 py-3.5 mb-4 bg-amberBg">
              <div className="text-[12.5px] font-bold mb-1" style={{ color: '#8A5A00' }}>
                Motivo da contestação
              </div>
              <div className="text-sm leading-snug">{d.motivo}</div>
            </div>

            <div className="flex flex-col gap-2.5 mb-4.5">
              {d.timeline.map((t, i) => (
                <div key={i} className="flex gap-2.5 text-[13px]">
                  <span className="rounded-full mt-1.5 flex-shrink-0" style={{ width: 6, height: 6, background: '#B8C2D4' }} />
                  <div>
                    <b>{t.autor}</b> {t.texto} <span className="text-textMuted">— {t.quando}</span>
                  </div>
                </div>
              ))}
            </div>

            {errorById[d.id] && <div className="text-[12.5px] font-semibold text-red mb-2.5">{errorById[d.id]}</div>}

            <div className="flex items-center gap-2.5 flex-wrap">
              {d.canSend && (
                <button type="button" onClick={() => sendEvidence(d.id)} className="px-3.5 py-2.5 rounded-lg border border-inputBorder bg-white text-navy text-[13px] font-bold cursor-pointer">
                  Enviar evidência (NF-e / comprovante)
                </button>
              )}
              {d.isSending && <div className="text-[13px] font-semibold text-textSecondary">Enviando evidência…</div>}
              {d.isSent && <div className="text-[13px] font-semibold text-green">Evidência enviada ✓</div>}
              <div className="flex-1" />
              <button
                type="button"
                onClick={() => resolve(d.id)}
                disabled={resolvingId === d.id}
                className="px-3.5 py-2.5 rounded-lg border-none bg-green text-white text-[13px] font-bold cursor-pointer disabled:opacity-60 disabled:cursor-default"
              >
                {resolvingId === d.id ? 'Resolvendo…' : 'Resolver — marcar aceita'}
              </button>
              <button type="button" className="px-3.5 py-2.5 rounded-lg bg-redBg text-red text-[13px] font-bold cursor-pointer" style={{ border: '1px solid #E9CFCB' }}>
                Escalar para arbitragem BC
              </button>
            </div>
          </div>
        ))}
        {disputes.length === 0 && (
          <div className="bg-white border border-border rounded-card">
            <EmptyState title="Nenhuma disputa em aberto" hint="Duplicatas contestadas pelo sacado vão aparecer aqui" />
          </div>
        )}
      </div>
    </div>
  );
}
