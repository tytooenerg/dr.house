import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { PageHeader } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';

interface Aceite {
  id: number;
  duplicataId: string;
  sacado: string;
  valorFmt: string;
  prazo: string;
  statusLabel: string;
  statusBg: string;
  statusColor: string;
  isPending: boolean;
  isProcessing: boolean;
}

const COLS = '1.1fr 1.3fr 0.9fr 1.2fr 1.3fr';

export function AceitePage() {
  const [aceites, setAceites] = useState<Aceite[]>([]);

  const load = () => api.get<{ aceites: Aceite[] }>('/aceites').then((d) => setAceites(d.aceites));

  useEffect(() => {
    load();
  }, []);

  const setStatus = async (id: number, status: 'aceita' | 'contestada') => {
    setAceites((prev) => prev.map((a) => (a.id === id ? { ...a, isProcessing: true } : a)));
    const data = await api.post<{ aceites: Aceite[] }>(`/aceites/${id}/status`, { status });
    setAceites(data.aceites);
  };

  return (
    <div>
      <PageHeader
        title="Aceite do Sacado"
        subtitle="Acompanhe a manifestação do sacado sobre cada duplicata — só duplicatas aceitas ou com aceite tácito podem ser negociadas com segurança jurídica plena"
      />

      <div className="bg-white border border-border rounded-card overflow-hidden">
        <div className="grid gap-3 px-5 py-3.5 bg-[#F7F8FA] border-b border-border text-xs font-bold text-textSecondary uppercase tracking-wide" style={{ gridTemplateColumns: COLS }}>
          <div>Duplicata</div>
          <div>Sacado</div>
          <div>Valor</div>
          <div>Prazo de manifestação</div>
          <div>Status / Ação</div>
        </div>
        {aceites.map((a) => (
          <div key={a.id} className="grid gap-3 px-5 py-4 border-b border-border last:border-b-0 items-center text-sm" style={{ gridTemplateColumns: COLS }}>
            <div className="font-mono-num font-bold text-[13px]">{a.duplicataId}</div>
            <div className="font-semibold">{a.sacado}</div>
            <div className="font-mono-num">{a.valorFmt}</div>
            <div className="text-textSecondary text-[13px]">{a.prazo}</div>
            <div className="flex items-center gap-2">
              {a.isProcessing && <div className="text-[11.5px] font-bold text-textSecondary px-2.5">Processando…</div>}
              {!a.isProcessing && a.isPending && (
                <>
                  <button
                    type="button"
                    onClick={() => setStatus(a.id, 'aceita')}
                    className="px-2.5 py-1.5 rounded-md text-[11.5px] font-bold cursor-pointer bg-greenBg text-green"
                    style={{ border: '1px solid #CFE6D9' }}
                  >
                    Marcar aceita
                  </button>
                  <button
                    type="button"
                    onClick={() => setStatus(a.id, 'contestada')}
                    className="px-2.5 py-1.5 rounded-md text-[11.5px] font-bold cursor-pointer bg-redBg text-red"
                    style={{ border: '1px solid #E9CFCB' }}
                  >
                    Contestar
                  </button>
                </>
              )}
              <span className="text-[11.5px] font-bold px-2.5 py-1 rounded-md" style={{ background: a.statusBg, color: a.statusColor }}>
                {a.statusLabel}
              </span>
            </div>
          </div>
        ))}
        {aceites.length === 0 && <EmptyState title="Nenhuma duplicata aguardando manifestação" hint="Novas duplicatas emitidas para você vão aparecer aqui" />}
      </div>
    </div>
  );
}
