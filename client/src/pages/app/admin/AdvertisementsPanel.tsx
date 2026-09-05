import { useEffect, useState } from 'react';
import { api, ApiError } from '../../../lib/api';
import { Button } from '../../../components/ui/Button';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorState } from '../../../components/ui/ErrorState';
import { PALETTE } from '../../../lib/palette';

interface PendingAd {
  id: number;
  empresa: string;
  logoUrl: string;
  titulo: string;
  texto: string;
  linkUrl: string;
  createdAt: string;
}

interface AdAssessment {
  assessment: 'ok' | 'atencao';
  reasoning: string;
}

// Fila de moderação do carrossel de publicidade (feature "Carrossel de publicidade") — um
// anúncio submetido por uma conta 'anunciante' (routes/advertisements.ts) só roda
// publicamente depois de aprovado aqui. Mesmo padrão de fila que CompliancePanel/SAR já
// usam: lista, motivo obrigatório pra rejeitar, decisão vira auditoria.
export function AdvertisementsPanel({ onCount }: { onCount?: (n: number) => void }) {
  const [pending, setPending] = useState<PendingAd[]>([]);
  const [rejectReasonById, setRejectReasonById] = useState<Record<number, string>>({});
  const [decidingId, setDecidingId] = useState<number | null>(null);
  const [screeningById, setScreeningById] = useState<Record<number, AdAssessment | null>>({});
  const [screeningLoadingId, setScreeningLoadingId] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = () => {
    setLoadError(null);
    return api
      .get<{ pending: PendingAd[] }>('/admin/advertisements')
      .then((d) => setPending(d.pending))
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : 'Falha ao carregar anúncios pendentes.'));
  };

  const screen = async (id: number) => {
    setScreeningLoadingId(id);
    try {
      const res = await api.get<{ assessment: AdAssessment | null }>(`/admin/advertisements/${id}/ai-screening`);
      setScreeningById((prev) => ({ ...prev, [id]: res.assessment }));
    } finally {
      setScreeningLoadingId(null);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    onCount?.(pending.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending.length]);

  const decide = async (id: number, decision: 'aprovado' | 'rejeitado') => {
    setDecidingId(id);
    try {
      await api.post(`/admin/advertisements/${id}/decidir`, { decision, rejectReason: rejectReasonById[id] });
      await load();
    } finally {
      setDecidingId(null);
    }
  };

  if (loadError) return <ErrorState message={loadError} onRetry={load} />;

  return (
    <div className="flex flex-col gap-4">
      <div className="text-textSecondary text-[12.5px]">
        Anúncios submetidos por contas anunciantes, aguardando revisão antes de rodar no carrossel de publicidade da página inicial.
      </div>

      {pending.map((ad) => (
        <div key={ad.id} className="bg-white border border-border rounded-card p-6">
          <div className="flex items-start gap-4 mb-4">
            <img src={ad.logoUrl} alt={ad.empresa} className="w-14 h-14 rounded-lg object-contain bg-surface border border-border flex-shrink-0" />
            <div>
              <div className="font-bold text-[15px]">{ad.titulo}</div>
              <div className="text-textSecondary text-[12.5px] mt-0.5">{ad.texto}</div>
              <div className="text-[11.5px] text-textTertiary mt-1.5">
                {ad.empresa} · <a href={ad.linkUrl} target="_blank" rel="noreferrer" className="text-blue">{ad.linkUrl}</a>
              </div>
            </div>
          </div>
          {screeningById[ad.id] === undefined ? (
            <Button size="sm" variant="secondary" className="mb-3" disabled={screeningLoadingId === ad.id} onClick={() => screen(ad.id)}>
              {screeningLoadingId === ad.id ? 'Analisando…' : 'Gerar triagem da IA (sugestão, não decide sozinha)'}
            </Button>
          ) : screeningById[ad.id] ? (
            <div
              className={`rounded-[10px] px-4 py-3 mb-3 text-[12.5px] ${screeningById[ad.id]!.assessment === 'ok' ? 'bg-chip' : ''}`}
              style={screeningById[ad.id]!.assessment === 'atencao' ? { background: PALETTE.redBg, color: PALETTE.red } : undefined}
            >
              <div className="font-bold mb-1">{screeningById[ad.id]!.assessment === 'atencao' ? 'IA sinaliza atenção' : 'IA não encontrou problemas'}</div>
              <div>{screeningById[ad.id]!.reasoning}</div>
            </div>
          ) : (
            <div className="text-[12px] text-textSecondary mb-3">Triagem indisponível (ANTHROPIC_API_KEY não configurada no servidor).</div>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            <input
              className="flex-1 min-w-[220px] px-3 py-2 rounded-md border border-inputBorder text-[12.5px]"
              placeholder="Motivo (obrigatório só para rejeitar)"
              value={rejectReasonById[ad.id] ?? ''}
              onChange={(e) => setRejectReasonById((prev) => ({ ...prev, [ad.id]: e.target.value }))}
            />
            <Button size="sm" variant="success" disabled={decidingId === ad.id} onClick={() => decide(ad.id, 'aprovado')}>
              Aprovar
            </Button>
            <Button size="sm" variant="ghost" disabled={decidingId === ad.id || !(rejectReasonById[ad.id] ?? '').trim()} onClick={() => decide(ad.id, 'rejeitado')}>
              Rejeitar
            </Button>
          </div>
        </div>
      ))}
      {pending.length === 0 && <EmptyState title="Nenhum anúncio pendente" hint="Submissões de contas anunciantes aparecem aqui" />}
    </div>
  );
}
