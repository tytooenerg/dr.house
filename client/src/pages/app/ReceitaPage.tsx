import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { PageSkeleton } from '../../components/ui/Skeleton';
import { PageHeader, Card, NavyCard } from '../../components/ui/Card';
import { Donut } from '../../components/ui/Gauge';
import { ErrorState } from '../../components/ui/ErrorState';
import { PALETTE } from '../../lib/palette';

interface RevenueStream {
  label: string;
  desc: string;
  valorFmt: string;
  pctFmt: string;
  color: string;
  gradFrom: number;
  gradTo: number;
}
interface RealFees {
  totalColetadoFmt: string;
  totalLiquidacoes: number;
  faixasFmt: { ateFmt: string; pctFmt: string }[];
  mediaEfetivaPct: number | null;
}
interface RealInsuranceCommission {
  totalComissaoFmt: string;
  totalPremiosFmt: string;
  totalApolices: number;
  comissaoPctFmt: string;
}
interface RealLegalCollectionFees {
  totalFeeFmt: string;
  totalRecoveredFmt: string;
  totalCasos: number;
  feePctFmt: string;
}
interface RevenueData {
  streams: RevenueStream[];
  totalFmt: string;
  realFees: RealFees;
  realInsuranceCommission: RealInsuranceCommission;
  realLegalCollectionFees: RealLegalCollectionFees;
}

export function ReceitaPage() {
  const [data, setData] = useState<RevenueData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = () => {
    setLoadError(null);
    api
      .get<RevenueData>('/revenue')
      .then(setData)
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : 'Falha ao carregar o modelo de receita.'));
  };

  useEffect(() => {
    load();
  }, []);

  if (loadError) return <ErrorState message={loadError} onRetry={load} />;
  if (!data) return <PageSkeleton />;

  return (
    <div>
      <PageHeader title="Modelo de Receita" subtitle="Todas as fontes de monetização da Lastro, num único lugar" />

      <Card className="mb-4">
        <div className="flex items-center justify-between mb-3.5 flex-wrap gap-2">
          <div>
            <div className="font-bold text-[15px]">Taxa de plataforma — cobrada de verdade</div>
            <div className="text-textSecondary text-[12.5px] mt-0.5">Descontada automaticamente na liquidação de cada compra (marketplace, cestas ou mercado secundário)</div>
          </div>
          <div className="text-right">
            <div className="text-[20px] font-extrabold">{data.realFees.totalColetadoFmt}</div>
            <div className="text-textTertiary text-[11.5px]">{data.realFees.totalLiquidacoes} liquidações até agora</div>
          </div>
        </div>
        <div className="flex gap-2.5 flex-wrap">
          {data.realFees.faixasFmt.map((f) => (
            <div key={f.ateFmt} className="flex-1 min-w-[160px] bg-surface border border-border rounded-lg px-3.5 py-2.5">
              <div className="text-textTertiary text-[11.5px] font-bold">{f.ateFmt}</div>
              <div className="text-[15px] font-extrabold mt-0.5">{f.pctFmt}</div>
            </div>
          ))}
        </div>
        {data.realFees.mediaEfetivaPct != null && (
          <div className="text-textTertiary text-[11.5px] mt-3">Taxa efetiva média sobre o volume total já liquidado: {data.realFees.mediaEfetivaPct}%</div>
        )}
      </Card>

      <Card className="mb-4">
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          <div>
            <div className="font-bold text-[15px]">Comissão de seguro — cobrada de verdade</div>
            <div className="text-textSecondary text-[12.5px] mt-0.5">
              {data.realInsuranceCommission.comissaoPctFmt} de cada prêmio pago por um investidor ao contratar seguro sobre uma posição — o restante é repassado à seguradora
            </div>
          </div>
          <div className="text-right">
            <div className="text-[20px] font-extrabold">{data.realInsuranceCommission.totalComissaoFmt}</div>
            <div className="text-textTertiary text-[11.5px]">
              {data.realInsuranceCommission.totalApolices} apólice(s) · {data.realInsuranceCommission.totalPremiosFmt} em prêmios
            </div>
          </div>
        </div>
      </Card>

      <Card className="mb-4">
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          <div>
            <div className="font-bold text-[15px]">Fee de sucesso — cobrança jurídica</div>
            <div className="text-textSecondary text-[12.5px] mt-0.5">
              {data.realLegalCollectionFees.feePctFmt} sobre o valor recuperado quando uma duplicata escalada ao Jurídico é paga — cobrado do credor
              atual (cedente ou investidor)
            </div>
          </div>
          <div className="text-right">
            <div className="text-[20px] font-extrabold">{data.realLegalCollectionFees.totalFeeFmt}</div>
            <div className="text-textTertiary text-[11.5px]">
              {data.realLegalCollectionFees.totalCasos} caso(s) · {data.realLegalCollectionFees.totalRecoveredFmt} recuperados
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: '1fr 1.6fr' }}>
        <NavyCard className="flex flex-col items-center py-6.5">
          <Donut stops={data.streams.map((s) => ({ color: s.color, from: s.gradFrom, to: s.gradTo }))} size={150} innerBg={PALETTE.navy}>
            <div className="text-[11.5px] text-onNavy">total</div>
            <div className="text-[15px] font-extrabold">{data.totalFmt}</div>
          </Donut>
          <div className="text-[12.5px] text-onNavy text-center mt-4">12 fontes de receita ativas — mix diversificado entre take rate, spread, API, dados e serviços agregados</div>
        </NavyCard>

        <Card>
          <div className="font-bold text-[15px] mb-1">Participação no faturamento</div>
          <div className="text-textTertiary text-[11.5px] mb-3.5">Mix projetado de longo prazo — a taxa de plataforma acima já é real, as demais fontes ainda são roadmap</div>
          <div className="flex flex-col gap-2.5">
            {data.streams.map((r) => (
              <div key={r.label} className="flex items-center gap-2.5">
                <span className="rounded-[2px] flex-shrink-0" style={{ width: 9, height: 9, background: r.color }} />
                <span className="flex-1 text-[13px] font-semibold">{r.label}</span>
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
              <div className="font-bold text-[14px]">{r.label}</div>
            </div>
            <div className="text-textSecondary text-[13px] leading-snug">{r.desc}</div>
          </Card>
        ))}
      </div>
    </div>
  );
}
