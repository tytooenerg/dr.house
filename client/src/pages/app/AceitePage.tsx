import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { PageHeader } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';

interface Aceite {
  id: number;
  duplicataId: string;
  sacado?: string;
  valorFmt: string;
  prazo: string;
  statusLabel: string;
  statusBg: string;
  statusColor: string;
  slaDiasRestantes: number | null;
  slaVencido: boolean;
}

const COLS = '1.1fr 1.3fr 0.9fr 1.2fr 1.3fr';

export function AceitePage() {
  const [aceites, setAceites] = useState<Aceite[]>([]);

  useEffect(() => {
    api.get<{ aceites: Aceite[] }>('/aceites').then((d) => setAceites(d.aceites));
  }, []);

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
          <div>Status</div>
        </div>
        {aceites.map((a) => (
          <div key={a.id} className="grid gap-3 px-5 py-4 border-b border-border last:border-b-0 items-center text-sm" style={{ gridTemplateColumns: COLS }}>
            <div className="font-mono-num font-bold text-[13px]">{a.duplicataId}</div>
            <div className="font-semibold">{a.sacado}</div>
            <div className="font-mono-num">{a.valorFmt}</div>
            <div className="text-textSecondary text-[13px]">{a.prazo}</div>
            <div className="flex flex-col gap-1 items-start">
              <span className="text-[11.5px] font-bold px-2.5 py-1 rounded-md w-fit" style={{ background: a.statusBg, color: a.statusColor }}>
                {a.statusLabel}
              </span>
              {a.slaDiasRestantes !== null && (
                <span className="text-[11px] font-semibold" style={{ color: a.slaVencido ? '#B3261E' : '#8A5A00' }}>
                  {a.slaVencido ? 'Prazo legal vencido' : `${a.slaDiasRestantes}d restantes`}
                </span>
              )}
            </div>
          </div>
        ))}
        {aceites.length === 0 && <EmptyState title="Nenhuma duplicata aguardando manifestação" hint="Novas duplicatas emitidas para você vão aparecer aqui" />}
      </div>
    </div>
  );
}
