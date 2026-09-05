import { useEffect, useState } from 'react';
import { api, ApiError } from '../../../lib/api';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorState } from '../../../components/ui/ErrorState';
import { PALETTE } from '../../../lib/palette';

interface ProgramaAdminView {
  id: number;
  sacadoNome: string;
  sacadoEmail: string;
  rating: string;
  taxaAmFmt: string;
  limiteFmt: string;
  utilizadoFmt: string;
  disponivelFmt: string;
  status: 'ativo' | 'pausado';
  membrosAtivos: number;
  utilizacaoPct: number;
  alertaLimite: boolean;
}

interface FundoOverview {
  balanceFmt: string;
  navFmt: string;
  cotaPriceFmt: string;
}

interface ConfirmingHealthSummary {
  headroomTotalFmt: string;
  fundoBalanceFmt: string;
  fundoSuficiente: boolean;
}

interface ConfirmingAdminData {
  programas: ProgramaAdminView[];
  fundo: FundoOverview;
  saude: ConfirmingHealthSummary;
}

const STATUS_STYLE: Record<'ativo' | 'pausado', { bg: string; color: string; label: string }> = {
  ativo: { bg: PALETTE.greenBg, color: PALETTE.green, label: 'Ativo' },
  pausado: { bg: PALETTE.hairline, color: PALETTE.textSecondary, label: 'Pausado' },
};

// Oversight do Programa Confirming — todo programa que já existe e o fundo real que os
// financia. Somente leitura: quem cria/gerencia um programa é o sacado, quem
// aporta/resgata no fundo é o investidor.
export function ConfirmingAdminPanel() {
  const [data, setData] = useState<ConfirmingAdminData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = () => {
    setLoadError(null);
    api
      .get<ConfirmingAdminData>('/admin/confirming')
      .then(setData)
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : 'Falha ao carregar o Programa Confirming.'));
  };

  useEffect(() => {
    load();
  }, []);

  if (loadError) return <ErrorState message={loadError} onRetry={load} />;
  if (!data) return <p className="text-[13px] text-navy/60">Carregando…</p>;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-[15px] font-bold text-navy">Programa Confirming</h2>
        <p className="text-[13px] text-navy/60 mt-1 max-w-2xl">
          Todo programa criado por um sacado, quantos cedentes tem matriculados, e o saldo real do fundo de fomento que financia cada compra
          automática.
        </p>
      </div>

      {!data.saude.fundoSuficiente && (
        <div className="px-4 py-3 rounded-[10px] text-[12.5px] font-semibold" style={{ background: PALETTE.redBg, color: PALETTE.red }}>
          Atenção: os programas ativos prometem até {data.saude.headroomTotalFmt} em financiamento, mas o fundo tem só{' '}
          {data.saude.fundoBalanceFmt} em caixa real. Um financiamento automático pode cair no fluxo normal de leilão por falta de capital do
          fundo, mesmo com limite disponível no programa.
        </div>
      )}

      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="bg-white border border-border rounded-card p-4">
          <div className="text-[11.5px] font-bold text-textSecondary uppercase mb-1">Saldo do fundo</div>
          <div className="text-xl font-extrabold font-mono-num">{data.fundo.balanceFmt}</div>
        </div>
        <div className="bg-white border border-border rounded-card p-4">
          <div className="text-[11.5px] font-bold text-textSecondary uppercase mb-1">NAV</div>
          <div className="text-xl font-extrabold font-mono-num">{data.fundo.navFmt}</div>
        </div>
        <div className="bg-white border border-border rounded-card p-4">
          <div className="text-[11.5px] font-bold text-textSecondary uppercase mb-1">Cota</div>
          <div className="text-xl font-extrabold font-mono-num">{data.fundo.cotaPriceFmt}</div>
        </div>
      </div>

      {data.programas.length === 0 ? (
        <EmptyState title="Nenhum Programa Confirming criado ainda" hint="A lista aparece assim que um sacado criar seu primeiro programa" />
      ) : (
        <div className="flex flex-col gap-2.5">
          {data.programas.map((p) => (
            <div key={p.id} className="bg-white border border-border rounded-card px-5 py-4 flex items-center justify-between gap-3 flex-wrap">
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-[14px]">{p.sacadoNome}</span>
                  <span className="text-textSecondary font-normal text-[12.5px]">· rating {p.rating}</span>
                  {p.alertaLimite && (
                    <span className="text-[10.5px] font-bold px-1.5 py-0.5 rounded-md" style={{ background: PALETTE.amberBg, color: PALETTE.amber }}>
                      {p.utilizacaoPct}% do limite utilizado
                    </span>
                  )}
                </div>
                <div className="text-textSecondary text-[12.5px]">
                  {p.sacadoEmail} · {p.membrosAtivos} fornecedor(es) matriculado(s) · taxa {p.taxaAmFmt}
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <div className="text-[11.5px] font-bold text-textSecondary uppercase">Utilizado / Limite</div>
                  <div className="font-mono-num text-[12.5px]">
                    {p.utilizadoFmt} / {p.limiteFmt}
                  </div>
                </div>
                <span className="text-[11.5px] font-bold px-2.5 py-1 rounded-md" style={{ background: STATUS_STYLE[p.status].bg, color: STATUS_STYLE[p.status].color }}>
                  {STATUS_STYLE[p.status].label}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
