import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { PageHeader } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { PALETTE } from '../../lib/palette';
import { useApi } from '../../lib/useApi';

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
  // Só na visão da empresa: pode mandar o link de aceite (server/src/lib/aceiteConvite.ts).
  podeConvidar?: boolean;
  convite?: { email: string | null; telefone: string | null; enviadoHa: string; respondido: boolean } | null;
}

interface ConviteEnviado {
  link: string;
  whatsappUrl: string;
  email: { destino: string; status: 'enviado' | 'simulado' } | null;
  whatsapp: { destino: string; status: 'enviado' | 'nao_configurado' } | null;
}

const COLS = '1.1fr 1.3fr 0.9fr 1.2fr 1.3fr';

export function AceitePage() {
  const [respondingId, setRespondingId] = useState<number | null>(null);
  const [errorById, setErrorById] = useState<Record<number, string>>({});

  const { data, error: loadError, reload: load } = useApi<{ aceites: Aceite[] }>('/aceites', { fallbackMessage: 'Falha ao carregar os aceites.' });
  const aceites = data?.aceites ?? [];

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
            {a.podeConvidar && <ConvidarSacado aceite={a} onEnviado={load} />}
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

// O sacado sem conta na Lastro não ficava sabendo da duplicata — a empresa esperava os 15 dias
// do aceite tácito. Daqui a empresa manda um link: o sacado confere e responde sem criar conta.
function ConvidarSacado({ aceite, onEnviado }: { aceite: Aceite; onEnviado: () => Promise<unknown> | void }) {
  const [aberto, setAberto] = useState(false);
  const [email, setEmail] = useState('');
  const [telefone, setTelefone] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');
  const [enviado, setEnviado] = useState<ConviteEnviado | null>(null);
  const [copiado, setCopiado] = useState(false);

  const enviar = async () => {
    setEnviando(true);
    setErro('');
    try {
      const res = await api.post<ConviteEnviado>(`/aceites/${aceite.id}/convite`, { email, telefone });
      setEnviado(res);
      setAberto(false);
      await onEnviado();
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Não foi possível enviar o link.');
    } finally {
      setEnviando(false);
    }
  };

  const copiar = async () => {
    if (!enviado) return;
    try {
      await navigator.clipboard.writeText(enviado.link);
      setCopiado(true);
    } catch {
      setCopiado(false);
    }
  };

  return (
    <div className="mx-5 mb-4 rounded-[10px] px-4 py-3 bg-surface text-[12.5px]" data-testid={`convite-${aceite.id}`}>
      {aceite.convite && !enviado && (
        <div className="text-textSecondary mb-2">
          Link enviado {aceite.convite.enviadoHa} para {[aceite.convite.email, aceite.convite.telefone].filter(Boolean).join(' e ')}.
        </div>
      )}
      {enviado && (
        <div className="mb-2.5 flex flex-col gap-1.5">
          {enviado.email && (
            <div>
              {enviado.email.status === 'enviado'
                ? `✓ E-mail enviado para ${enviado.email.destino}.`
                : `E-mail para ${enviado.email.destino} não foi enviado de verdade (e-mail da plataforma ainda não configurado) — use o WhatsApp ou copie o link.`}
            </div>
          )}
          {enviado.whatsapp && enviado.whatsapp.status === 'enviado' && <div>✓ WhatsApp enviado para {enviado.whatsapp.destino}.</div>}
          <div className="flex gap-2 flex-wrap items-center">
            <a
              href={enviado.whatsappUrl}
              target="_blank"
              rel="noreferrer"
              className="px-3 py-1.5 rounded-md bg-green text-white font-bold no-underline"
            >
              Enviar pelo meu WhatsApp
            </a>
            <button type="button" onClick={copiar} className="px-3 py-1.5 rounded-md border border-border bg-white font-bold cursor-pointer">
              {copiado ? 'Link copiado' : 'Copiar link'}
            </button>
          </div>
        </div>
      )}
      {!aberto ? (
        <button type="button" onClick={() => setAberto(true)} className="bg-transparent border-none text-blue font-bold cursor-pointer underline p-0">
          {aceite.convite || enviado ? 'Reenviar link de aceite' : 'Enviar link de aceite para o sacado'}
        </button>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="text-textSecondary">O sacado recebe um link, confere a duplicata e confirma (ou contesta) sem precisar criar conta.</div>
          <div className="flex gap-2 flex-wrap">
            <input
              aria-label="E-mail do sacado"
              placeholder="e-mail do financeiro do sacado"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="flex-1 min-w-[200px] px-2.5 py-1.5 rounded-md border border-inputBorder bg-white"
            />
            <input
              aria-label="WhatsApp do sacado"
              placeholder="WhatsApp (com DDD)"
              value={telefone}
              onChange={(e) => setTelefone(e.target.value)}
              className="w-[180px] px-2.5 py-1.5 rounded-md border border-inputBorder bg-white"
            />
            <button
              type="button"
              disabled={enviando}
              onClick={enviar}
              className="px-3 py-1.5 rounded-md border-none bg-blue text-white font-bold cursor-pointer disabled:opacity-60"
            >
              {enviando ? 'Enviando…' : 'Enviar link'}
            </button>
          </div>
          {erro && <div className="text-red font-semibold">{erro}</div>}
        </div>
      )}
    </div>
  );
}
