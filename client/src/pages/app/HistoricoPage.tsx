import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { PageHeader, Card, NavyCard } from '../../components/ui/Card';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { EmptyState } from '../../components/ui/EmptyState';

interface Historico {
  data: string;
  empresa: string;
  investidoFmt: string;
  retornoFmt: string;
  status: string;
}

const COLS = '1fr 1.4fr 0.9fr 0.9fr 0.9fr';

export function HistoricoPage() {
  const [historico, setHistorico] = useState<Historico[]>([]);

  useEffect(() => {
    api.get<{ historico: Historico[] }>('/historico').then((d) => setHistorico(d.historico));
  }, []);

  return (
    <div>
      <PageHeader title="Carteira & Histórico" subtitle="Suas operações concluídas e retornos obtidos" />

      <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <NavyCard>
          <div className="text-[#8B97AC] text-[13px] font-semibold">Total investido</div>
          <div className="text-2xl font-extrabold mt-2.5">R$ 842.600</div>
        </NavyCard>
        <Card>
          <div className="text-textSecondary text-[13px] font-semibold">Retorno acumulado</div>
          <div className="text-2xl font-extrabold mt-2.5 text-green">+R$ 31.240</div>
        </Card>
        <Card>
          <div className="text-textSecondary text-[13px] font-semibold">Rentabilidade média</div>
          <div className="text-2xl font-extrabold mt-2.5">1,8% a.m.</div>
        </Card>
      </div>

      <Card className="mb-4 px-6 py-5">
        <div className="font-bold text-[14.5px] mb-3.5">Saúde da carteira — mesma linguagem usada em FIDCs</div>
        <div className="grid gap-5" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div>
            <div className="flex justify-between items-center text-[13px] mb-1.5">
              <span className="text-textSecondary">Atraso ≤ 15 dias (% do PL)</span>
              <span className="font-bold font-mono-num">8,2%</span>
            </div>
            <ProgressBar pct={8.2} color="#B8790A" height={7} />
            <div className="text-textTertiary text-[11.5px] mt-1">Faixa saudável de mercado: 7,5%–9%</div>
          </div>
          <div>
            <div className="flex justify-between items-center text-[13px] mb-1.5">
              <span className="text-textSecondary">Inadimplência ≥ 90 dias (% do PL)</span>
              <span className="font-bold font-mono-num">3,9%</span>
            </div>
            <ProgressBar pct={3.9} color="#0A5C36" height={7} />
            <div className="text-textTertiary text-[11.5px] mt-1">Faixa saudável de mercado: 3,5%–5%</div>
          </div>
        </div>
      </Card>

      <div className="bg-white border border-border rounded-card overflow-hidden">
        <div className="grid gap-3 px-5 py-3.5 bg-[#F7F8FA] border-b border-border text-xs font-bold text-textSecondary uppercase tracking-wide" style={{ gridTemplateColumns: COLS }}>
          <div>Data</div>
          <div>Empresa</div>
          <div>Investido</div>
          <div>Retorno</div>
          <div>Status</div>
        </div>
        {historico.map((h, i) => (
          <div key={i} className="grid gap-3 px-5 py-4 border-b border-border last:border-b-0 items-center text-sm" style={{ gridTemplateColumns: COLS }}>
            <div className="text-textSecondary font-mono-num text-[13px]">{h.data}</div>
            <div className="font-semibold">{h.empresa}</div>
            <div className="font-mono-num">{h.investidoFmt}</div>
            <div className="font-mono-num text-green font-bold">{h.retornoFmt}</div>
            <span className="inline-block text-[11.5px] font-bold px-2.5 py-1 rounded-md bg-greenBg text-green w-fit">{h.status}</span>
          </div>
        ))}
        {historico.length === 0 && <EmptyState title="Nenhuma operação ainda" hint="Suas operações concluídas vão aparecer aqui" />}
      </div>
    </div>
  );
}
