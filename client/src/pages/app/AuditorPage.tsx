import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { PageHeader, Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { PageSkeleton } from '../../components/ui/Skeleton';
import { useLang } from '../../lib/i18n';
import { PALETTE } from '../../lib/palette';
import { useApi } from '../../lib/useApi';

interface AuditorOverview {
  auditLog: {
    entries: { id: number; actor: string; action: string; quando: string; hash: string }[];
    chain: { valid: boolean; brokenAt: number | null };
  };
  compliance: { pendentes: number; itens: { duplicataId: string; sacadoNome: string; valorFmt: string; score: number }[] };
  reconciliation: { abertas: number; resolvidas: number; recentes: { tipo: string; empresa: string; valorFmt: string; status: string; quando: string }[] };
  sars: { aberto: number; descartado: number; reportado_coaf: number };
  // O servidor já mandava `disputas` desde que a visão foi criada, e esta interface não
  // declarava o campo — então a tela nunca o desenhou. Dado servido e nunca lido é o mesmo
  // que dado ausente pra quem usa o painel.
  disputas: {
    abertas: number;
    resolvidas: number;
    recentes: { duplicataId: string; sacado: string; cedente: string; valorFmt: string; resolved: boolean; quando: string }[];
  };
  otc: {
    abertas: number;
    aceitas: number;
    encerradas: number;
    volumeAceitoFmt: string;
    recentes: {
      id: number;
      duplicataId: string;
      sacado: string;
      comprador: string;
      vendedor: string;
      valorFmt: string;
      valorFaceFmt: string;
      status: string;
      rodadas: number;
      quando: string;
    }[];
  };
}

// The entire 'auditor' role surface: one read-only screen, no action ever available here.
// Quase tudo aqui é o que o admin já vê em Compliance/Reconciliação/PLD/Disputas, sem
// nenhum dos controles de escrita. O balcão é a exceção — nem o admin tem essa visão —, e
// lib/auditorOverview.ts explica por que ela existe só para a supervisão.
export function AuditorPage() {
  const { t } = useLang();
  const { data, error: loadError, reload: load, setData } = useApi<AuditorOverview>('/auditor/overview', { fallbackMessage: 'Falha ao carregar o painel de auditoria.' });

  if (loadError) return <ErrorState message={loadError} onRetry={load} />;
  if (!data) return <PageSkeleton />;

  return (
    <div>
      <PageHeader
        title={t('auditor.title', 'Painel de Auditoria')}
        subtitle={t('auditor.subtitle', 'Acesso somente-leitura — nenhuma ação de escrita está disponível neste papel')}
      />

      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
        <Card>
          <div className="text-[11.5px] font-bold text-textSecondary uppercase mb-1.5">Cadeia de auditoria</div>
          <div className="font-bold text-lg" style={{ color: data.auditLog.chain.valid ? PALETTE.green : PALETTE.red }}>
            {data.auditLog.chain.valid ? 'Íntegra ✓' : `Violação em #${data.auditLog.chain.brokenAt}`}
          </div>
        </Card>
        <Card>
          <div className="text-[11.5px] font-bold text-textSecondary uppercase mb-1.5">Compliance pendente</div>
          <div className="font-mono-num font-bold text-lg">{data.compliance.pendentes}</div>
        </Card>
        <Card>
          <div className="text-[11.5px] font-bold text-textSecondary uppercase mb-1.5">Reconciliação em aberto</div>
          <div className="font-mono-num font-bold text-lg" style={{ color: data.reconciliation.abertas > 0 ? PALETTE.red : undefined }}>
            {data.reconciliation.abertas}
          </div>
        </Card>
        <Card>
          <div className="text-[11.5px] font-bold text-textSecondary uppercase mb-1.5">Alertas de PLD abertos</div>
          <div className="font-mono-num font-bold text-lg">{data.sars.aberto}</div>
        </Card>
        <Card>
          <div className="text-[11.5px] font-bold text-textSecondary uppercase mb-1.5">Balcão liquidado</div>
          <div className="font-mono-num font-bold text-lg">{data.otc.volumeAceitoFmt}</div>
          <div className="text-textTertiary text-[11.5px] mt-0.5">
            {data.otc.aceitas} fechadas · {data.otc.abertas} em aberto
          </div>
        </Card>
      </div>

      <Card className="mb-6">
        <div className="font-bold text-[15px] mb-3">{t('auditor.trail', 'Trilha de auditoria (últimos 100 eventos)')}</div>
        {data.auditLog.entries.length === 0 ? (
          <EmptyState title="Nenhum evento registrado ainda" hint="Ações sensíveis da plataforma vão aparecer aqui" />
        ) : (
          <div className="flex flex-col gap-1.5 max-h-96 overflow-y-auto">
            {data.auditLog.entries.map((e) => (
              <div key={e.id} className="flex items-center justify-between gap-3 text-[13px] border-b border-border last:border-b-0 pb-2 pt-1">
                <div>
                  <b>{e.actor}</b> — {e.action}
                  <span className="text-textSecondary"> · {e.quando}</span>
                </div>
                <span className="font-mono-num text-[11.5px] text-textTertiary">#{e.hash}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <div className="font-bold text-[15px] mb-3">{t('auditor.complianceQueue', 'Fila de compliance pendente')}</div>
          {data.compliance.itens.length === 0 ? (
            <EmptyState title="Fila vazia" hint="Nenhuma duplicata suspensa para revisão" />
          ) : (
            <div className="flex flex-col gap-2">
              {data.compliance.itens.map((c) => (
                <div key={c.duplicataId} className="flex items-center justify-between text-[12.5px] border-b border-border last:border-b-0 pb-2">
                  <span>
                    {c.duplicataId} — {c.sacadoNome}
                  </span>
                  <span className="font-mono-num font-bold">
                    {c.valorFmt} · score {c.score}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card>
          <div className="font-bold text-[15px] mb-3">{t('auditor.recentReconciliation', 'Reconciliação recente')}</div>
          {data.reconciliation.recentes.length === 0 ? (
            <EmptyState title="Nenhum evento" hint="Nenhuma divergência de pagamento recente" />
          ) : (
            <div className="flex flex-col gap-2">
              {data.reconciliation.recentes.map((r, i) => (
                <div key={i} className="flex items-center justify-between text-[12.5px] border-b border-border last:border-b-0 pb-2">
                  <span>
                    {r.tipo} — {r.empresa}
                  </span>
                  <span className="font-mono-num font-bold" style={{ color: r.status === 'aberta' ? PALETTE.red : PALETTE.green }}>
                    {r.valorFmt} · {r.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Balcão (OTC). É a única negociação da plataforma que acontece fora de um livro
          público — preço e contraparte combinados diretamente entre duas mesas —, então é a
          que mais precisa ser auditável. O valor de face ao lado do negociado é a comparação
          que denuncia um preço fora de mercado; o número de rodadas mostra se houve barganha
          de verdade ou um acerto de uma tacada só. */}
      <Card className="mt-4">
        <div className="flex items-baseline justify-between gap-3 mb-1">
          <div className="font-bold text-[15px]">{t('auditor.otc', 'Balcão (OTC) — negociação bilateral')}</div>
          <div className="text-textSecondary text-[12px] font-mono-num">
            {data.otc.aceitas} fechadas · {data.otc.abertas} abertas · {data.otc.encerradas} sem liquidar
          </div>
        </div>
        <div className="text-textSecondary text-[12.5px] mb-3">
          Negociações fora do book, entre duas contas. Somente-leitura, como todo este painel.
        </div>
        {data.otc.recentes.length === 0 ? (
          <EmptyState title="Nenhuma negociação de balcão" hint="Propostas dirigidas entre investidores vão aparecer aqui" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-textSecondary text-left">
                  <th className="font-bold pb-2 pr-3">Duplicata</th>
                  <th className="font-bold pb-2 pr-3">Vendedor → Comprador</th>
                  <th className="font-bold pb-2 pr-3 text-right">Negociado</th>
                  <th className="font-bold pb-2 pr-3 text-right">Face</th>
                  <th className="font-bold pb-2 pr-3 text-right">Rodadas</th>
                  <th className="font-bold pb-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.otc.recentes.map((n) => (
                  <tr key={n.id} className="border-t border-border">
                    <td className="py-2 pr-3">
                      {n.duplicataId}
                      <span className="text-textTertiary"> · {n.sacado}</span>
                    </td>
                    <td className="py-2 pr-3">
                      {n.vendedor} → {n.comprador}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono-num font-bold">{n.valorFmt}</td>
                    <td className="py-2 pr-3 text-right font-mono-num text-textSecondary">{n.valorFaceFmt}</td>
                    <td className="py-2 pr-3 text-right font-mono-num">{n.rodadas}</td>
                    <td className="py-2" style={{ color: n.status === 'aceita' ? PALETTE.green : n.status === 'aberta' ? undefined : PALETTE.textSecondary }}>
                      {n.status}
                      <span className="text-textTertiary"> · {n.quando}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Disputas. O servidor já servia este bloco; a tela nunca o desenhou. */}
      <Card className="mt-4">
        <div className="flex items-baseline justify-between gap-3 mb-3">
          <div className="font-bold text-[15px]">{t('auditor.disputes', 'Disputas de aceite')}</div>
          <div className="text-textSecondary text-[12px] font-mono-num">
            {data.disputas.abertas} abertas · {data.disputas.resolvidas} resolvidas
          </div>
        </div>
        {data.disputas.recentes.length === 0 ? (
          <EmptyState title="Nenhuma disputa" hint="Contestações de sacado vão aparecer aqui" />
        ) : (
          <div className="flex flex-col gap-2">
            {data.disputas.recentes.map((d, i) => (
              <div key={i} className="flex items-center justify-between gap-3 text-[12.5px] border-b border-border last:border-b-0 pb-2">
                <span>
                  {d.duplicataId} — {d.sacado}
                  <span className="text-textTertiary"> vs. {d.cedente} · {d.quando}</span>
                </span>
                <span className="font-mono-num font-bold whitespace-nowrap" style={{ color: d.resolved ? PALETTE.green : PALETTE.red }}>
                  {d.valorFmt} · {d.resolved ? 'resolvida' : 'aberta'}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
