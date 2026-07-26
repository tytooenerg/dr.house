import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { PageHeader, Card, NavyCard } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { PageSkeleton } from '../../components/ui/Skeleton';

interface Apolice {
  id: string;
  cedente: string;
  sacado: string;
  valorFmt: string;
  vencimento: string;
  premioFmt: string;
  status: string;
  sinistroStatus: string;
}
interface Sinistro {
  id: string;
  cedente: string;
  sacado: string;
  valorFmt: string;
  vencimento: string;
}
interface SeguradoraData {
  insurerName: string;
  premioPctFmt: string;
  totalApolices: number;
  totalSeguradoFmt: string;
  totalPremioFmt: string;
  apolices: Apolice[];
  sinistros: Sinistro[];
}

export function SeguradoraPage() {
  const [data, setData] = useState<SeguradoraData | null>(null);
  const [noteById, setNoteById] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = () => api.get<SeguradoraData>('/seguradora').then(setData);

  useEffect(() => {
    load();
  }, []);

  const decide = async (id: string, decision: 'aprovado' | 'negado') => {
    const note = noteById[id]?.trim();
    if (!note) return;
    setBusyId(id);
    try {
      const updated = await api.post<SeguradoraData>(`/seguradora/sinistro/${id}/decidir`, { decision, note });
      setData(updated);
    } finally {
      setBusyId(null);
    }
  };

  if (!data) return <PageSkeleton />;

  return (
    <div>
      <PageHeader title="Painel da Seguradora" subtitle={`${data.insurerName} — apólices e sinistros sobre duplicatas seguradas na Lastro`} />

      <div className="grid gap-4 mb-6" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <NavyCard>
          <div className="text-[#8B97AC] text-[13px] font-semibold">Apólices ativas</div>
          <div className="text-2xl font-extrabold mt-2.5">{data.totalApolices}</div>
        </NavyCard>
        <Card>
          <div className="text-textSecondary text-[13px] font-semibold">Valor total segurado</div>
          <div className="text-2xl font-extrabold mt-2.5">{data.totalSeguradoFmt}</div>
        </Card>
        <Card>
          <div className="text-textSecondary text-[13px] font-semibold">Prêmio acumulado ({data.premioPctFmt})</div>
          <div className="text-2xl font-extrabold mt-2.5 text-green">{data.totalPremioFmt}</div>
        </Card>
      </div>

      <div className="font-bold text-[15px] mb-3">Sinistros aguardando decisão</div>
      <div className="flex flex-col gap-4 mb-6">
        {data.sinistros.map((s) => (
          <div key={s.id} className="bg-white rounded-card p-6" style={{ border: '1px solid #E9CFCB' }}>
            <div className="flex justify-between items-start flex-wrap gap-2.5 mb-3">
              <div>
                <div className="font-mono-num font-bold text-[13px] text-textSecondary">{s.id}</div>
                <div className="font-bold text-[16px] mt-1">
                  {s.sacado} não pagou {s.cedente} — {s.valorFmt}
                </div>
                <div className="text-textSecondary text-[12.5px] mt-1">Venceu em {s.vencimento} e nunca foi vendida no marketplace</div>
              </div>
              <span className="text-[11.5px] font-bold px-3 py-1.5 rounded-md bg-amberBg text-amber">Sinistro aberto</span>
            </div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <input
                className="flex-1 min-w-[220px] px-3 py-2 rounded-md border border-inputBorder text-[13px]"
                placeholder="Nota da decisão"
                value={noteById[s.id] ?? ''}
                onChange={(e) => setNoteById((prev) => ({ ...prev, [s.id]: e.target.value }))}
              />
              <Button size="sm" variant="success" disabled={busyId === s.id} onClick={() => decide(s.id, 'aprovado')}>
                Aprovar e indenizar
              </Button>
              <Button size="sm" variant="danger" disabled={busyId === s.id} onClick={() => decide(s.id, 'negado')}>
                Negar sinistro
              </Button>
            </div>
          </div>
        ))}
        {data.sinistros.length === 0 && (
          <div className="bg-white border border-border rounded-card">
            <EmptyState title="Nenhum sinistro em aberto" hint="Duplicatas seguradas, vencidas e não pagas aparecem aqui" />
          </div>
        )}
      </div>

      <div className="font-bold text-[15px] mb-3">Apólices</div>
      <div className="bg-white border border-border rounded-card overflow-hidden">
        <div
          className="grid gap-3 px-5 py-3.5 bg-[#F7F8FA] border-b border-border text-xs font-bold text-textSecondary uppercase tracking-wide"
          style={{ gridTemplateColumns: '1.2fr 1fr 0.9fr 0.9fr 0.9fr 0.9fr' }}
        >
          <div>Cedente</div>
          <div>Sacado</div>
          <div>Valor</div>
          <div>Vencimento</div>
          <div>Prêmio</div>
          <div>Status</div>
        </div>
        {data.apolices.map((a) => (
          <div key={a.id} className="grid gap-3 px-5 py-4 border-b border-border last:border-b-0 items-center text-sm" style={{ gridTemplateColumns: '1.2fr 1fr 0.9fr 0.9fr 0.9fr 0.9fr' }}>
            <div className="font-semibold">{a.cedente}</div>
            <div className="text-textSecondary">{a.sacado}</div>
            <div className="font-mono-num">{a.valorFmt}</div>
            <div className="text-textSecondary">{a.vencimento}</div>
            <div className="font-mono-num text-green font-bold">{a.premioFmt}</div>
            <div className="text-[11.5px] font-bold">
              {a.sinistroStatus === 'none' ? 'Sem sinistro' : a.sinistroStatus === 'aprovado' ? 'Indenizada' : 'Negada'}
            </div>
          </div>
        ))}
        {data.apolices.length === 0 && <EmptyState title="Nenhuma apólice ainda" hint="Duplicatas seguradas pela sua seguradora aparecem aqui" />}
      </div>
    </div>
  );
}
