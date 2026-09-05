import { useEffect, useState } from 'react';
import { api, ApiError } from '../../../lib/api';
import { Button } from '../../../components/ui/Button';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorState } from '../../../components/ui/ErrorState';
import { PALETTE } from '../../../lib/palette';

interface PendingKyb {
  id: number;
  nome: string;
  email: string;
  companyName: string;
  kybForm: { cnpj?: string; tipo?: string; pl?: string; paisDomicilio?: string; taxIdEstrangeiro?: string; representanteLegal?: string };
  naoResidente: boolean;
  submittedAt: string;
  pldStatus: 'clear' | 'flagged';
  pldMatchNote: string;
  aiTriage: { runId: number; status: string; summary: string | null; pendingActionId: number | null; pendingActionTool: 'aprovar_kyb' | 'rejeitar_kyb' | null } | null;
}

interface ForeignInvestorScreening {
  id: number;
  paisDomicilio: string;
  jurisdicaoFavorecida: boolean;
  classificacao: 'profissional' | 'qualificado' | 'nao_classificado';
  representanteLegal: string;
  pldStatus: 'clear' | 'flagged';
  pldDetail: string;
  memo: string;
  quando: string;
}

// Fila de KYB — a única tab do Back Office que registra também investidores estrangeiros
// não residentes (memorando de elegibilidade, IRRF zero, jurisdição favorecida), além do
// fluxo padrão de aprovar/rejeitar credenciamento com pré-triagem opcional do Agente de
// Onboarding.
export function KybPanel({ onCount }: { onCount?: (n: number) => void }) {
  const [pending, setPending] = useState<PendingKyb[]>([]);
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [decidingTriageId, setDecidingTriageId] = useState<number | null>(null);
  const [foreignScreeningsById, setForeignScreeningsById] = useState<Record<number, ForeignInvestorScreening[]>>({});
  const [generatingMemoId, setGeneratingMemoId] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadKyb = () => {
    setLoadError(null);
    return api
      .get<{ pending: PendingKyb[] }>('/admin/kyb')
      .then((d) => setPending(d.pending))
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : 'Falha ao carregar a fila de KYB.'));
  };

  useEffect(() => {
    loadKyb();
  }, []);

  useEffect(() => {
    onCount?.(pending.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending.length]);

  useEffect(() => {
    for (const p of pending) {
      if (p.naoResidente && !(p.id in foreignScreeningsById)) loadForeignScreenings(p.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  if (loadError) return <ErrorState message={loadError} onRetry={loadKyb} />;

  const loadForeignScreenings = (userId: number) =>
    api.get<{ screenings: ForeignInvestorScreening[] }>(`/admin/kyb/${userId}/elegibilidade-estrangeiro`).then((d) => {
      setForeignScreeningsById((prev) => ({ ...prev, [userId]: d.screenings }));
    });

  const generateForeignMemo = async (userId: number) => {
    setGeneratingMemoId(userId);
    try {
      await api.post(`/admin/kyb/${userId}/elegibilidade-estrangeiro/gerar`);
      await loadForeignScreenings(userId);
    } finally {
      setGeneratingMemoId(null);
    }
  };

  const approve = async (userId: number) => {
    await api.post(`/admin/kyb/${userId}/approve`);
    loadKyb();
  };

  const reject = async (userId: number) => {
    if (!rejectReason.trim()) return;
    await api.post(`/admin/kyb/${userId}/reject`, { reason: rejectReason.trim() });
    setRejectingId(null);
    setRejectReason('');
    loadKyb();
  };

  const decideAiTriage = async (pendingActionId: number, action: 'approve' | 'reject') => {
    setDecidingTriageId(pendingActionId);
    try {
      await api.post(`/agents/pending/${pendingActionId}/${action}`, {});
      await loadKyb();
    } finally {
      setDecidingTriageId(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {pending.map((p) => (
        <div key={p.id} className="bg-white border border-border rounded-card p-6">
          <div className="flex justify-between items-start flex-wrap gap-2.5 mb-3">
            <div>
              <div className="font-bold text-[15px]">{p.companyName}</div>
              <div className="text-textSecondary text-[13px]">
                {p.nome} · {p.email}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap justify-end">
              {p.naoResidente && (
                <span className="text-[11.5px] font-bold px-3 py-1.5 rounded-md" style={{ background: PALETTE.chip, color: PALETTE.blue }}>
                  Investidor não residente
                </span>
              )}
              <span className="text-[11.5px] font-bold px-3 py-1.5 rounded-md bg-amberBg text-amber">Aguardando análise — {p.submittedAt}</span>
            </div>
          </div>
          {p.pldStatus === 'flagged' && (
            <div className="rounded-[10px] px-4 py-3 mb-3 text-[12.5px]" style={{ background: PALETTE.redBg, color: PALETTE.red }}>
              <b>PLD/FT — possível correspondência (lista de demonstração)</b>
              <div className="mt-0.5">{p.pldMatchNote}</div>
            </div>
          )}
          {p.naoResidente ? (
            <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
              <div className="text-[13px]">
                <div className="text-textTertiary text-[11.5px] uppercase font-bold mb-1">País de domicílio</div>
                {p.kybForm.paisDomicilio || '—'}
              </div>
              <div className="text-[13px]">
                <div className="text-textTertiary text-[11.5px] uppercase font-bold mb-1">ID fiscal estrangeiro</div>
                {p.kybForm.taxIdEstrangeiro || '—'}
              </div>
              <div className="text-[13px]">
                <div className="text-textTertiary text-[11.5px] uppercase font-bold mb-1">Representante no Brasil</div>
                {p.kybForm.representanteLegal || '—'}
              </div>
            </div>
          ) : (
            <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
              <div className="text-[13px]">
                <div className="text-textTertiary text-[11.5px] uppercase font-bold mb-1">CNPJ</div>
                {p.kybForm.cnpj || '—'}
              </div>
              <div className="text-[13px]">
                <div className="text-textTertiary text-[11.5px] uppercase font-bold mb-1">Tipo</div>
                {p.kybForm.tipo || '—'}
              </div>
              <div className="text-[13px]">
                <div className="text-textTertiary text-[11.5px] uppercase font-bold mb-1">PL para alocação</div>
                R$ {p.kybForm.pl || '—'}
              </div>
            </div>
          )}

          {p.aiTriage && (
            <div className="rounded-[10px] p-4 mb-4" style={{ background: PALETTE.chip }}>
              <div className="flex items-center justify-between mb-1.5 flex-wrap gap-2">
                <div className="font-bold text-[13px] flex items-center gap-2">
                  Pré-triagem do Agente de Onboarding (IA)
                  <span className="px-2 py-0.5 rounded-md text-[10.5px] font-bold bg-white text-blue">{p.aiTriage.status}</span>
                </div>
              </div>
              <div className="text-[12.5px] text-textSecondary whitespace-pre-wrap">{p.aiTriage.summary || 'Investigação em andamento…'}</div>
              {p.aiTriage.pendingActionId && (
                <div className="flex items-center gap-2 mt-3">
                  <span className="text-[12.5px] font-bold">
                    A IA recomenda: {p.aiTriage.pendingActionTool === 'aprovar_kyb' ? 'aprovar' : 'rejeitar'} — confirmar?
                  </span>
                  <Button size="sm" disabled={decidingTriageId === p.aiTriage.pendingActionId} onClick={() => decideAiTriage(p.aiTriage!.pendingActionId!, 'approve')}>
                    Confirmar recomendação
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={decidingTriageId === p.aiTriage.pendingActionId}
                    onClick={() => decideAiTriage(p.aiTriage!.pendingActionId!, 'reject')}
                  >
                    Ignorar
                  </Button>
                </div>
              )}
            </div>
          )}

          {p.naoResidente && (
            <div className="rounded-[10px] p-4 mb-4 bg-bg">
              <div className="flex items-center justify-between mb-2">
                <div className="font-bold text-[13px]">Memorando de elegibilidade — investidor não residente</div>
                <Button size="sm" variant="secondary" disabled={generatingMemoId === p.id} onClick={() => generateForeignMemo(p.id)}>
                  {generatingMemoId === p.id ? 'Gerando…' : 'Gerar memorando'}
                </Button>
              </div>
              {(foreignScreeningsById[p.id] ?? []).length === 0 ? (
                <div className="text-[12.5px] text-textSecondary">Nenhum memorando gerado ainda para este investidor.</div>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {foreignScreeningsById[p.id].slice(0, 3).map((s) => (
                    <div key={s.id} className="bg-white border border-border rounded-[10px] p-3.5">
                      <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className="text-[11.5px] font-bold px-2.5 py-1 rounded-md"
                            style={
                              s.classificacao === 'profissional' ? { background: PALETTE.greenBg, color: PALETTE.green } : { background: PALETTE.hairline, color: PALETTE.textSecondary }
                            }
                          >
                            {s.classificacao === 'profissional' ? 'Investidor profissional' : 'Não classificado'}
                          </span>
                          <span
                            className="text-[11.5px] font-bold px-2.5 py-1 rounded-md"
                            style={s.jurisdicaoFavorecida ? { background: PALETTE.redBg, color: PALETTE.red } : { background: PALETTE.greenBg, color: PALETTE.green }}
                          >
                            {s.jurisdicaoFavorecida ? 'Jurisdição de tributação favorecida' : 'IRRF zero elegível (sujeito a confirmação jurídica)'}
                          </span>
                          <span
                            className="text-[11.5px] font-bold px-2.5 py-1 rounded-md"
                            style={s.pldStatus === 'flagged' ? { background: PALETTE.redBg, color: PALETTE.red } : { background: PALETTE.greenBg, color: PALETTE.green }}
                          >
                            PLD: {s.pldStatus === 'flagged' ? 'correspondência encontrada' : 'sem correspondência'}
                          </span>
                        </div>
                        <span className="text-[11.5px] text-textTertiary">{s.quando}</span>
                      </div>
                      <pre className="text-[11.5px] text-textSecondary whitespace-pre-wrap font-sans leading-relaxed">{s.memo}</pre>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {rejectingId === p.id ? (
            <div className="flex items-center gap-2.5 flex-wrap">
              <input
                className="flex-1 min-w-[220px] px-3 py-2 rounded-md border border-inputBorder text-[13px]"
                placeholder="Motivo da rejeição"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
              />
              <Button size="sm" variant="danger" onClick={() => reject(p.id)}>
                Confirmar rejeição
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setRejectingId(null)}>
                Cancelar
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2.5">
              <Button size="sm" variant="success" onClick={() => approve(p.id)}>
                Aprovar credenciamento
              </Button>
              <Button size="sm" variant="danger" onClick={() => setRejectingId(p.id)}>
                Rejeitar
              </Button>
            </div>
          )}
        </div>
      ))}
      {pending.length === 0 && (
        <div className="bg-white border border-border rounded-card">
          <EmptyState title="Nenhum credenciamento pendente" hint="Novas solicitações de investidores institucionais aparecem aqui" />
        </div>
      )}
    </div>
  );
}

export type { PendingKyb };
