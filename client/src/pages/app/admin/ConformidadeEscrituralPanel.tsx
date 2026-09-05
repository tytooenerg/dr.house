import { useEffect, useState } from 'react';
import { api, ApiError } from '../../../lib/api';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorState } from '../../../components/ui/ErrorState';
import { PALETTE } from '../../../lib/palette';
import { useApi } from '../../../lib/useApi';

type Status = 'nao_informado' | 'assistida_disponivel' | 'obrigatorio_pleno';

interface Row {
  userId: number;
  companyName: string;
  role: 'cedente' | 'sacado';
  email: string;
  bracket: string | null;
  bracketLabel: string | null;
  status: Status;
  statusLabel: string;
  diasRestantes: number | null;
}

interface Summary {
  rows: Row[];
  countsByStatus: Record<Status, number>;
}

const STATUS_STYLE: Record<Status, { bg: string; color: string; label: string }> = {
  nao_informado: { bg: PALETTE.hairline, color: PALETTE.textSecondary, label: 'Não informado' },
  assistida_disponivel: { bg: PALETTE.amberBg, color: PALETTE.amber, label: 'Produção assistida' },
  obrigatorio_pleno: { bg: PALETTE.greenBg, color: PALETTE.green, label: 'Regime pleno' },
};

// Visão de oversight do cronograma de obrigatoriedade da duplicata escritural (BCB) —
// somente leitura: quem informa a própria faixa de faturamento é o cedente/sacado
// (ComplianceCalendarCard, em CompliancePage/SacadoPage), não o admin.
export function ConformidadeEscrituralPanel() {

  const { data: summary, error: loadError, reload: load, setData: setSummary } = useApi<Summary>('/admin/conformidade-escritural', { fallbackMessage: 'Falha ao carregar a conformidade escritural.' });

  if (loadError) return <ErrorState message={loadError} onRetry={load} />;
  if (!summary) return <p className="text-[13px] text-navy/60">Carregando…</p>;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-[15px] font-bold text-navy">Conformidade — Duplicata Escritural</h2>
        <p className="text-[13px] text-navy/60 mt-1 max-w-2xl">
          Quantos cedentes/sacados já informaram sua faixa de faturamento anual e em que status de obrigatoriedade cada um está, conforme o
          cronograma do Banco Central.
        </p>
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        {(['nao_informado', 'assistida_disponivel', 'obrigatorio_pleno'] as Status[]).map((status) => (
          <div key={status} className="bg-white border border-border rounded-card p-4">
            <div className="text-2xl font-extrabold font-mono-num">{summary.countsByStatus[status]}</div>
            <span className="inline-block mt-1.5 text-[11.5px] font-bold px-2.5 py-1 rounded-md" style={{ background: STATUS_STYLE[status].bg, color: STATUS_STYLE[status].color }}>
              {STATUS_STYLE[status].label}
            </span>
          </div>
        ))}
      </div>

      {summary.rows.length === 0 ? (
        <EmptyState title="Nenhum cedente ou sacado cadastrado ainda" hint="A lista aparece assim que houver contas cedente/sacado na plataforma" />
      ) : (
        <div className="flex flex-col gap-2.5">
          {summary.rows.map((r) => (
            <div key={r.userId} className="bg-white border border-border rounded-card px-5 py-4 flex items-center justify-between gap-3 flex-wrap">
              <div>
                <div className="font-bold text-[14px]">{r.companyName}</div>
                <div className="text-textSecondary text-[12.5px]">
                  {r.email} · {r.role === 'cedente' ? 'Cedente' : 'Sacado'}
                  {r.bracketLabel ? ` · ${r.bracketLabel}` : ''}
                </div>
              </div>
              <div className="flex items-center gap-3">
                {r.status === 'assistida_disponivel' && r.diasRestantes !== null && (
                  <span className="text-textSecondary text-[12.5px] font-mono-num">{r.diasRestantes} dias restantes</span>
                )}
                <span className="text-[11.5px] font-bold px-2.5 py-1 rounded-md" style={{ background: STATUS_STYLE[r.status].bg, color: STATUS_STYLE[r.status].color }}>
                  {STATUS_STYLE[r.status].label}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
