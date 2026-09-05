import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { PageHeader, Card } from '../../components/ui/Card';
import { Field, Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { ErrorState } from '../../components/ui/ErrorState';
import { PALETTE } from '../../lib/palette';
import { Badge } from '../../components/ui/Badge';

interface CestaDef {
  key: 'conservadora' | 'diversificada' | 'agressiva';
  label: string;
  desc: string;
  ratings: string[];
  faixa: { minFmt: string; maxFmt: string; medioFmt: string; real: boolean };
}
interface InvestResult {
  comprados: { duplicataId: string; sacado: string; rating: string; valorFmt: string; desagio: string }[];
  totalInvestidoFmt: string;
  restanteFmt: string;
  ofertasDisponiveis: number;
}

export function CestasPage() {
  const [cestas, setCestas] = useState<CestaDef[]>([]);
  const [selected, setSelected] = useState<CestaDef['key'] | null>(null);
  const [valor, setValor] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<InvestResult | null>(null);
  const [error, setError] = useState('');
  const [needsSuitability, setNeedsSuitability] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = () => {
    setLoadError(null);
    return api
      .get<{ cestas: CestaDef[] }>('/cestas')
      .then((d) => setCestas(d.cestas))
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : 'Falha ao carregar as cestas de investimento.'));
  };

  useEffect(() => {
    load();
  }, []);

  const investir = async () => {
    if (!selected) return;
    setLoading(true);
    setError('');
    setResult(null);
    setNeedsSuitability(false);
    try {
      const res = await api.post<InvestResult>('/cestas/investir', { cesta: selected, valor });
      setResult(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível investir agora.');
      const code = err instanceof ApiError && err.body && typeof err.body === 'object' ? (err.body as { error?: string }).error : undefined;
      setNeedsSuitability(code === 'suitability_required' || code === 'suitability_mismatch');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <PageHeader title="Cestas de Investimento" subtitle="Invista um valor e deixe a Lastro alocar entre as melhores ofertas do perfil escolhido" />

      {loadError && <ErrorState message={loadError} onRetry={load} />}

      {!loadError && (
      <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        {cestas.map((c) => (
          <Card
            key={c.key}
            className="cursor-pointer"
            style={selected === c.key ? { outline: `2px solid ${PALETTE.blue}` } : undefined}
            onClick={() => setSelected(c.key)}
          >
            <div className="font-bold text-[15px] mb-1.5">{c.label}</div>
            <div className="text-textSecondary text-[12.5px] mb-3">{c.desc}</div>
            <div className="flex gap-1.5 flex-wrap mb-3">
              {c.ratings.map((r) => (
                <span key={r} className="text-[11.5px] font-bold px-2 py-0.5 rounded bg-hairline text-textSecondary">
                  {r}
                </span>
              ))}
            </div>
            <div className="text-[12.5px] font-semibold" style={{ color: c.faixa.real ? PALETTE.green : PALETTE.textTertiary }}>
              {c.faixa.real ? 'Faixa hoje' : 'Faixa teórica (sem oferta aberta agora)'}:{' '}
              <span className="font-mono-num">
                {c.faixa.minFmt}–{c.faixa.maxFmt}
              </span>{' '}
              <span className="text-textTertiary font-normal">(média {c.faixa.medioFmt})</span>
            </div>
          </Card>
        ))}
      </div>
      )}

      {selected && (
        <Card className="mb-4">
          <div className="font-bold text-[15px] mb-3.5">Investir em "{cestas.find((c) => c.key === selected)?.label}"</div>
          <div className="flex items-end gap-3">
            <div className="flex-1 max-w-[280px]">
              <Field label="Valor a investir">
                <Input value={valor} onChange={(e) => setValor(e.target.value)} placeholder="50.000,00" />
              </Field>
            </div>
            <Button disabled={loading || !valor} onClick={investir}>
              {loading ? 'Investindo…' : 'Investir agora'}
            </Button>
          </div>
          {error && (
            <div className="mt-3 text-red text-[12.5px] font-semibold">
              {error}
              {needsSuitability && (
                <>
                  {' '}
                  <Link to="/app/suitability" className="underline">
                    Responder questionário de suitability
                  </Link>
                </>
              )}
            </div>
          )}
        </Card>
      )}

      {result && (
        <Card>
          <div className="font-bold text-[15px] mb-3.5">Alocação realizada</div>
          <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div>
              <div className="text-textTertiary text-[11.5px] font-bold uppercase">Total investido</div>
              <div className="text-[20px] font-extrabold">{result.totalInvestidoFmt}</div>
            </div>
            <div>
              <div className="text-textTertiary text-[11.5px] font-bold uppercase">Não alocado</div>
              <div className="text-[20px] font-extrabold">{result.restanteFmt}</div>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            {result.comprados.map((c) => (
              <div key={c.duplicataId} className="flex items-center justify-between text-[13px] bg-surface border border-border rounded-lg px-3.5 py-2.5">
                <span className="font-semibold">{c.sacado}</span>
                <Badge variant="neutral">{c.rating}</Badge>
                <span className="text-textSecondary">{c.desagio}</span>
                <span className="font-mono-num font-bold">{c.valorFmt}</span>
              </div>
            ))}
            {result.comprados.length === 0 && <div className="text-textSecondary text-[12.5px]">Nenhuma oferta coube no valor informado.</div>}
          </div>
        </Card>
      )}
    </div>
  );
}
