import { useEffect, useState } from 'react';
import { PublicNav, PublicFooter } from './PublicChrome';

interface Stats {
  volumeEmitidoFmt: string;
  volumeFinanciadoFmt: string;
  totalDuplicatas: number;
  totalCedentes: number;
  totalInvestidores: number;
  totalSacadosDistintos: number;
  taxaInadimplenciaPct: number;
  tempoMedioLiquidacaoHoras: number | null;
  geradoEm: string;
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border border-border rounded-card p-6">
      <div className="text-textTertiary text-[12.5px] font-bold uppercase tracking-wide mb-2">{label}</div>
      <div className="text-[32px] font-extrabold tracking-tight">{value}</div>
      {hint && <div className="text-textSecondary text-[12.5px] mt-1.5">{hint}</div>}
    </div>
  );
}

export function TransparenciaPage() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    fetch('/api/public/stats')
      .then((r) => r.json())
      .then(setStats)
      .catch(() => {});
  }, []);

  return (
    <div className="w-full text-navy min-h-screen">
      <PublicNav active="transparencia" />
      <div className="max-w-[880px] mx-auto px-6 py-16">
        <div className="text-[38px] font-extrabold tracking-tight mb-2">Transparência</div>
        <div className="text-[16px] text-textSecondary mb-10 max-w-[560px]">
          Números reais, calculados ao vivo a partir da nossa base — não são metas nem projeções de marketing.
        </div>

        {!stats && <div className="text-textTertiary">Carregando…</div>}

        {stats && (
          <>
            <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <Metric label="Volume total emitido" value={stats.volumeEmitidoFmt} hint="Soma de todas as duplicatas registradas na plataforma" />
              <Metric label="Volume total financiado" value={stats.volumeFinanciadoFmt} hint="Soma de todas as compras já realizadas por investidores" />
            </div>
            <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
              <Metric label="Duplicatas registradas" value={String(stats.totalDuplicatas)} />
              <Metric label="Empresas cedentes" value={String(stats.totalCedentes)} />
              <Metric label="Investidores ativos" value={String(stats.totalInvestidores)} />
            </div>
            <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <Metric label="Taxa de inadimplência" value={`${stats.taxaInadimplenciaPct}%`} hint="Duplicatas vencidas sem liquidação, sobre o total de duplicatas vencidas" />
              <Metric
                label="Tempo médio até liquidação"
                value={stats.tempoMedioLiquidacaoHoras != null ? `${stats.tempoMedioLiquidacaoHoras}h` : '—'}
                hint="Entre a emissão e a compra por um investidor"
              />
            </div>
            <div className="text-textTertiary text-xs">Atualizado em {new Date(stats.geradoEm).toLocaleString('pt-BR')}</div>
          </>
        )}
      </div>
      <PublicFooter />
    </div>
  );
}
