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
}

// The entire 'auditor' role surface: one read-only screen, no action ever available here —
// same data admin sees in Compliance/Reconciliação/PLD, just without any write control.
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

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
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
    </div>
  );
}
