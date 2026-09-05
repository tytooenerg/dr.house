import { useEffect, useState } from 'react';
import { api, ApiError } from '../../../lib/api';
import { Button } from '../../../components/ui/Button';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorState } from '../../../components/ui/ErrorState';

interface TedPendente {
  referencia: string;
  empresa: string;
  valorFmt: string;
  banco: string;
  agencia: string;
  conta: string;
  quando: string;
}

export function TedPendentesPanel() {
  const [tedPendentes, setTedPendentes] = useState<TedPendente[]>([]);
  const [confirmingTed, setConfirmingTed] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadTedPendentes = () => {
    setLoadError(null);
    return api
      .get<{ pendentes: TedPendente[] }>('/admin/ted/pendentes')
      .then((d) => setTedPendentes(d.pendentes))
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : 'Falha ao carregar os TEDs pendentes.'));
  };

  useEffect(() => {
    loadTedPendentes();
  }, []);

  if (loadError) return <ErrorState message={loadError} onRetry={loadTedPendentes} />;

  const confirmarTed = async (referencia: string) => {
    setConfirmingTed(referencia);
    try {
      await api.post(`/admin/ted/${referencia}/confirmar`);
      await loadTedPendentes();
    } finally {
      setConfirmingTed(null);
    }
  };

  return (
    <div className="bg-white border border-border rounded-card overflow-hidden mt-5">
      <div className="px-5 py-3.5 border-b border-border">
        <div className="font-bold text-[14px]">Depósitos via TED pendentes de confirmação</div>
        <div className="text-[12.5px] text-textMuted mt-0.5">Sem webhook automático (ver lib/tedRail.ts) — confira o extrato bancário real antes de confirmar</div>
      </div>
      {tedPendentes.map((t) => (
        <div key={t.referencia} className="px-5 py-3 border-b border-bg last:border-b-0 flex items-center justify-between gap-3 text-[13px]">
          <div>
            <b>{t.empresa}</b> — {t.valorFmt}
            <span className="text-textMuted">
              {' '}
              · {t.banco} ag. {t.agencia} cc {t.conta} · ref. {t.referencia} · {t.quando}
            </span>
          </div>
          <Button size="sm" variant="success" disabled={confirmingTed === t.referencia} onClick={() => confirmarTed(t.referencia)}>
            {confirmingTed === t.referencia ? 'Confirmando…' : 'Confirmar recebimento'}
          </Button>
        </div>
      ))}
      {tedPendentes.length === 0 && <EmptyState title="Nenhum TED pendente" hint="Depósitos via TED aparecem aqui até serem confirmados" />}
    </div>
  );
}
