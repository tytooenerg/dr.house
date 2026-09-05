import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { PageHeader } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { PALETTE } from '../../lib/palette';

interface Aceite {
  id: number;
  duplicataId: string;
  sacado?: string;
  valorFmt: string;
  prazo: string;
  statusLabel: string;
  statusBg: string;
  statusColor: string;
  slaDiasRestantes: number | null;
  slaVencido: boolean;
  disputeProposal: { disputeId: number; note: string; quando: string } | null;
}

const COLS = '1.1fr 1.3fr 0.9fr 1.2fr 1.3fr';

export function AceitePage() {
  const [aceites, setAceites] = useState<Aceite[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [respondingId, setRespondingId] = useState<number | null>(null);
  const [errorById, setErrorById] = useState<Record<number, string>>({});

  const load = () => {
    setLoadError(null);
    return api
      .get<{ aceites: Aceite[] }>('/aceites')
      .then((d) => setAceites(d.aceites))
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : 'Falha ao carregar os aceites.'));
  };

  useEffect(() => {
    load();
  }, []);

  // Uma proposta do cedente (routes/disputas.ts's POST /:id/propor) nunca resolve a
  // disputa sozinha — só o próprio sacado confirmando de verdade restaura o aceite.
  const responder = async (disputeId: number, acao: 'confirmar' | 'recusar') => {
    setErrorById((prev) => ({ ...prev, [disputeId]: '' }));
    setRespondingId(disputeId);
    try {
      await api.post(`/disputas/${disputeId}/${acao}`, {});
      await load();
    } catch (err) {
      setErrorById((prev) => ({ ...prev, [disputeId]: err instanceof ApiError ? err.message : 'Não foi possível responder agora — tente de novo.' }));
    } finally {
      setRespondingId(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Aceite do Sacado"
        subtitle="Acompanhe a manifestação do sacado sobre cada duplicata — só duplicatas aceitas ou com aceite tácito podem ser negociadas com segurança jurídica plena"
      />

      {loadError && <ErrorState message={loadError} onRetry={load} />}

      {!loadError && (
      <div role="table" aria-label="Duplicatas aguardando aceite" className="bg-white border border-border rounded-card overflow-hidden">
        <div role="rowgroup"><div role="row" className="grid gap-3 px-5 py-3.5 bg-surface border-b border-border text-xs font-bold text-textSecondary uppercase tracking-wide" style={{ gridTemplateColumns: COLS }}>
          <div role="columnheader">Duplicata</div>
          <div role="columnheader">Sacado</div>
          <div role="columnheader">Valor</div>
          <div role="columnheader">Prazo de manifestação</div>
          <div role="columnheader">Status</div>
        </div></div>
        {aceites.map((a) => (
          <div key={a.id} className="border-b border-border last:border-b-0">
            <div role="row" className="grid gap-3 px-5 py-4 items-center text-sm" style={{ gridTemplateColumns: COLS }}>
              <div role="cell" className="font-mono-num font-bold text-[13px]">{a.duplicataId}</div>
              <div role="cell" className="font-semibold">{a.sacado}</div>
              <div role="cell" className="font-mono-num">{a.valorFmt}</div>
              <div role="cell" className="text-textSecondary text-[13px]">{a.prazo}</div>
              <div role="cell" className="flex flex-col gap-1 items-start">
                <span className="text-[11.5px] font-bold px-2.5 py-1 rounded-md w-fit" style={{ background: a.statusBg, color: a.statusColor }}>
                  {a.statusLabel}
                </span>
                {a.slaDiasRestantes !== null && (
                  <span className="text-[11.5px] font-semibold" style={{ color: a.slaVencido ? PALETTE.red : PALETTE.amber }}>
                    {a.slaVencido ? 'Prazo legal vencido' : `${a.slaDiasRestantes}d restantes`}
                  </span>
                )}
              </div>
            </div>
            {a.disputeProposal && (
              <div className="mx-5 mb-4 rounded-[10px] px-4 py-3.5 bg-amberBg">
                <div className="text-[12.5px] font-bold mb-1" style={{ color: PALETTE.amber }}>
                  O cedente propôs uma resolução {a.disputeProposal.quando ? `— ${a.disputeProposal.quando}` : ''}
                </div>
                <div className="text-sm leading-snug mb-3">{a.disputeProposal.note}</div>
                {errorById[a.disputeProposal.disputeId] && (
                  <div className="text-[12.5px] font-semibold text-red mb-2">{errorById[a.disputeProposal.disputeId]}</div>
                )}
                <div className="flex gap-2.5">
                  <button
                    type="button"
                    onClick={() => responder(a.disputeProposal!.disputeId, 'confirmar')}
                    disabled={respondingId === a.disputeProposal.disputeId}
                    className="px-3.5 py-2 rounded-lg border-none bg-green text-white text-[13px] font-bold cursor-pointer disabled:opacity-60 disabled:cursor-default"
                  >
                    {respondingId === a.disputeProposal.disputeId ? 'Enviando…' : 'Confirmar resolução'}
                  </button>
                  <button
                    type="button"
                    onClick={() => responder(a.disputeProposal!.disputeId, 'recusar')}
                    disabled={respondingId === a.disputeProposal.disputeId}
                    className="px-3.5 py-2 rounded-lg bg-white text-red text-[13px] font-bold cursor-pointer disabled:opacity-60 disabled:cursor-default"
                    style={{ border: `1px solid ${PALETTE.redBorder}` }}
                  >
                    Recusar — pedir arbitragem
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
        {aceites.length === 0 && <EmptyState title="Nenhuma duplicata aguardando manifestação" hint="Novas duplicatas emitidas para você vão aparecer aqui" />}
      </div>
      )}
    </div>
  );
}
