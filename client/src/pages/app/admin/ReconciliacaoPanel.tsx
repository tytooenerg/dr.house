import { useEffect, useState } from 'react';
import { api, ApiError } from '../../../lib/api';
import { Button } from '../../../components/ui/Button';
import { EmptyState } from '../../../components/ui/EmptyState';

interface ReconciliationFlag {
  id: number;
  tipo: 'pix' | 'boleto' | 'ted';
  referencia: string;
  company_name: string;
  valor: number;
  descricao: string;
  status: 'aberta' | 'resolvida';
  created_at: string;
  resolved_at: string | null;
}

const TIPO_LABEL: Record<ReconciliationFlag['tipo'], string> = { pix: 'Pix', boleto: 'Boleto', ted: 'TED' };

export function ReconciliacaoPanel() {
  const [flags, setFlags] = useState<ReconciliationFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [resolvingId, setResolvingId] = useState<number | null>(null);
  const [runResult, setRunResult] = useState<{ checked: number; matched: number; newlyFlagged: number } | null>(null);
  const [error, setError] = useState('');

  const load = () =>
    api.get<{ flags: ReconciliationFlag[] }>('/reconciliation/flags').then((d) => {
      setFlags(d.flags);
      setLoading(false);
    });

  useEffect(() => {
    load();
  }, []);

  const run = async () => {
    setError('');
    setRunning(true);
    try {
      const result = await api.post<{ checked: number; matched: number; newlyFlagged: number }>('/reconciliation/run');
      setRunResult(result);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível rodar a reconciliação.');
    } finally {
      setRunning(false);
    }
  };

  const resolve = async (id: number) => {
    setError('');
    setResolvingId(id);
    try {
      await api.post(`/reconciliation/flags/${id}/resolver`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível resolver o alerta.');
    } finally {
      setResolvingId(null);
    }
  };

  const open = flags.filter((f) => f.status === 'aberta');
  const resolved = flags.filter((f) => f.status === 'resolvida');

  if (loading) return <p className="text-[13px] text-navy/60">Carregando…</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-[16px] font-bold text-navy">Reconciliação de pagamentos</h2>
          <p className="text-[13px] text-navy/60 mt-1 max-w-2xl">
            Compara confirmações reais de Pix/boleto/TED contra o extrato de cada conta e sinaliza qualquer confirmação sem lançamento
            correspondente — ver server/src/lib/reconciliation.ts. Pagamentos simulados não entram nesta checagem.
          </p>
        </div>
        <Button disabled={running} onClick={run}>
          {running ? 'Rodando…' : 'Rodar reconciliação agora'}
        </Button>
      </div>

      {runResult && (
        <div className="text-[12.5px] text-navy/70 bg-bg rounded-lg px-3.5 py-2.5 w-fit">
          Última execução: {runResult.checked} eventos checados · {runResult.matched} conferidos · {runResult.newlyFlagged} novos alertas
        </div>
      )}
      {error && <p className="text-[12.5px] text-red font-semibold">{error}</p>}

      <div>
        <div className="text-[13px] font-bold text-navy mb-2">Alertas abertos ({open.length})</div>
        {open.length === 0 ? (
          <EmptyState title="Nenhum alerta aberto" hint="Todas as confirmações de pagamento recentes têm lançamento correspondente no extrato" />
        ) : (
          <div className="flex flex-col gap-2">
            {open.map((f) => (
              <div key={f.id} className="border border-border rounded-xl p-4 flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10.5px] font-bold px-1.5 py-0.5 rounded bg-[#FBF1E0] text-[#9A6B10]">{TIPO_LABEL[f.tipo]}</span>
                    <span className="text-[13px] font-bold text-navy">{f.company_name}</span>
                  </div>
                  <p className="text-[12.5px] text-navy/70 mt-1 max-w-2xl">{f.descricao}</p>
                  <div className="text-[11px] text-navy/40 mt-1">Aberto em {f.created_at}</div>
                </div>
                <Button size="sm" disabled={resolvingId === f.id} onClick={() => resolve(f.id)}>
                  {resolvingId === f.id ? 'Resolvendo…' : 'Marcar resolvido'}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {resolved.length > 0 && (
        <div>
          <div className="text-[13px] font-bold text-navy mb-2">Resolvidos ({resolved.length})</div>
          <div className="flex flex-col gap-1.5">
            {resolved.map((f) => (
              <div key={f.id} className="text-[12px] text-navy/50 flex items-center gap-2">
                <span className="font-bold">{TIPO_LABEL[f.tipo]}</span>
                <span>{f.company_name}</span>
                <span>— resolvido em {f.resolved_at}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
