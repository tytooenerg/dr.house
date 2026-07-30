import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useSession } from '../../state/SessionContext';

interface Aceite {
  id: number;
  duplicataId: string;
  valorFmt: string;
  prazo: string;
  statusLabel: string;
  statusBg: string;
  statusColor: string;
  isPending: boolean;
  isProcessing?: boolean;
  cedente?: string;
  slaDiasRestantes: number | null;
  slaVencido: boolean;
}

export function SacadoPage() {
  const { user } = useSession();
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
      <div className="mb-2">
        <div className="text-[26px] font-extrabold tracking-tight">Portal do Sacado</div>
        <div className="text-textSecondary text-sm mt-1">Visão que a empresa pagadora vê ao entrar na Lastro para confirmar ou contestar duplicatas emitidas contra ela</div>
      </div>
      <div className="inline-flex items-center gap-2 px-3.5 py-2 rounded-full bg-chip text-blue text-[12.5px] font-bold mb-6">
        <span className="w-[22px] h-[22px] rounded-full bg-blue text-white flex items-center justify-center text-[10px]">
          {user?.companyName.slice(0, 2).toUpperCase()}
        </span>
        Logado como: {user?.companyName} (sacado)
      </div>

      <div className="flex flex-col gap-3.5">
        {aceites.map((a) => (
          <div key={a.id} className="bg-white border border-border rounded-card px-6 py-5 flex flex-col gap-3.5">
            <div className="min-w-0">
              <div className="font-mono-num text-xs text-textSecondary">{a.duplicataId}</div>
              <div className="font-bold text-[15px] mt-0.5">{a.valorFmt} a pagar — emitida por {a.cedente || 'um fornecedor'}</div>
              <div className="text-textSecondary text-[12.5px] mt-1">{a.prazo}</div>
            </div>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <span className="text-[11.5px] font-bold px-2.5 py-1 rounded-md" style={{ background: a.statusBg, color: a.statusColor }}>
                {a.statusLabel}
              </span>
              {a.isPending && a.slaDiasRestantes !== null && (
                <span
                  className="text-[11.5px] font-bold px-2.5 py-1 rounded-md"
                  style={a.slaVencido ? { background: '#F7E9E7', color: '#B3261E' } : { background: '#FBF1E0', color: '#8A5A00' }}
                >
                  {a.slaVencido ? 'Prazo legal de aceite vencido' : `Vence em ${a.slaDiasRestantes} dia${a.slaDiasRestantes === 1 ? '' : 's'} (prazo legal)`}
                </span>
              )}
              {a.isProcessing && <div className="text-[12.5px] font-bold text-textSecondary">Processando…</div>}
              {!a.isProcessing && a.isPending && (
                <div className="flex gap-2">
                  <button type="button" onClick={() => setStatus(a.id, 'aceita')} className="px-3.5 py-2 rounded-lg border-none bg-green text-white text-[12.5px] font-bold cursor-pointer hover:opacity-90">
                    Confirmar recebimento
                  </button>
                  <button
                    type="button"
                    onClick={() => setStatus(a.id, 'contestada')}
                    className="px-3.5 py-2 rounded-lg bg-white text-red text-[12.5px] font-bold cursor-pointer hover:opacity-85"
                    style={{ border: '1px solid #E9CFCB' }}
                  >
                    Contestar esta duplicata
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
