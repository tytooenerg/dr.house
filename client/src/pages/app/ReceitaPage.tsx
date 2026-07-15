import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { PageSkeleton } from '../../components/ui/Skeleton';
import { PageHeader, Card, NavyCard } from '../../components/ui/Card';
import { Donut } from '../../components/ui/Gauge';

interface RevenueStream {
  label: string;
  desc: string;
  valorFmt: string;
  pctFmt: string;
  color: string;
  gradFrom: number;
  gradTo: number;
}
interface RevenueData {
  streams: RevenueStream[];
  totalFmt: string;
}

export function ReceitaPage() {
  const [data, setData] = useState<RevenueData | null>(null);

  useEffect(() => {
    api.get<RevenueData>('/revenue').then(setData);
  }, []);

  if (!data) return <PageSkeleton />;

  return (
    <div>
      <PageHeader title="Modelo de Receita" subtitle="Todas as fontes de monetização da Lastro, num único lugar" />

      <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: '1fr 1.6fr' }}>
        <NavyCard className="flex flex-col items-center py-6.5">
          <Donut stops={data.streams.map((s) => ({ color: s.color, from: s.gradFrom, to: s.gradTo }))} size={150} innerBg="#0B1F3A">
            <div className="text-[11px] text-[#9FB3D6]">total</div>
            <div className="text-[15px] font-extrabold">{data.totalFmt}</div>
          </Donut>
          <div className="text-[12.5px] text-[#9FB3D6] text-center mt-4">12 fontes de receita ativas — mix diversificado entre take rate, spread, API, dados e serviços agregados</div>
        </NavyCard>

        <Card>
          <div className="font-bold text-[15px] mb-4">Participação no faturamento</div>
          <div className="flex flex-col gap-2.5">
            {data.streams.map((r) => (
              <div key={r.label} className="flex items-center gap-2.5">
                <span className="rounded-[2px] flex-shrink-0" style={{ width: 9, height: 9, background: r.color }} />
                <span className="flex-1 text-[13.5px] font-semibold">{r.label}</span>
                <span className="text-[13px] text-textSecondary font-mono-num">{r.valorFmt}</span>
                <span className="text-[12.5px] font-bold w-12 text-right">{r.pctFmt}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: '1fr 1fr' }}>
        {data.streams.map((r) => (
          <Card key={r.label} className="px-5 py-5">
            <div className="flex items-center gap-2 mb-2">
              <span className="rounded-[2px]" style={{ width: 8, height: 8, background: r.color }} />
              <div className="font-bold text-[14.5px]">{r.label}</div>
            </div>
            <div className="text-textSecondary text-[13px] leading-snug">{r.desc}</div>
          </Card>
        ))}
      </div>
    </div>
  );
}
