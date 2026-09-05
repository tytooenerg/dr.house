import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { PageHeader, Card, NavyCard } from '../../components/ui/Card';
import { Segmented } from '../../components/ui/Segmented';
import { RangeBar } from '../../components/ui/ProgressBar';
import { ErrorState } from '../../components/ui/ErrorState';
import { Badge } from '../../components/ui/Badge';

interface RateChannel {
  label: string;
  isLastro: boolean;
  rangeLabel: string;
  leftPct: number;
  widthPct: number;
  barColor: string;
}
interface Estimate {
  rangeLabel: string;
  desagioFmt: string;
  liquidoFmt: string;
}

export function ComparadorPage() {
  const [input, setInput] = useState({ valor: '50.000', prazo: '30', score: 'A' });
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [channels, setChannels] = useState<RateChannel[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = () => {
    setLoadError(null);
    Promise.all([
      api.get<{ rateChannels: RateChannel[] }>('/comparador/rates').then((d) => setChannels(d.rateChannels)),
      api.post<Estimate>('/comparador/estimate', input).then(setEstimate),
    ]).catch((err) => setLoadError(err instanceof ApiError ? err.message : 'Falha ao carregar o comparador de taxas.'));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setField = async (field: string, value: string) => {
    const nextInput = { ...input, [field]: value };
    setInput(nextInput);
    const data = await api.post<Estimate & { rateChannels: RateChannel[] }>('/comparador/estimate', nextInput);
    setEstimate(data);
    setChannels(data.rateChannels);
  };

  if (loadError) return <ErrorState message={loadError} onRetry={load} />;

  return (
    <div>
      <PageHeader title="Comparador de Taxas" subtitle="Taxa média de antecipação por canal — leilão multi-financiador reduz o spread" />

      <NavyCard className="p-7 mb-5">
        <div className="font-bold text-[15px] mb-1">Simule a sua operação</div>
        <div className="text-onNavy text-[12.5px] mb-5">Estimativa com base no score do sacado, valor e prazo — via leilão Lastro</div>
        <div className="grid gap-3.5 mb-5" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <div>
            <div className="text-xs font-bold text-onNavy mb-1.5">Valor (R$)</div>
            <input aria-label="Valor a antecipar"
              value={input.valor}
              onChange={(e) => setField('valor', e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-lg text-white outline-none text-sm"
              style={{ border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.06)' }}
            />
          </div>
          <div>
            <div className="text-xs font-bold text-onNavy mb-1.5">Prazo (dias)</div>
            <input aria-label="Prazo em dias"
              value={input.prazo}
              onChange={(e) => setField('prazo', e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-lg text-white outline-none text-sm"
              style={{ border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.06)' }}
            />
          </div>
          <div>
            <div className="text-xs font-bold text-onNavy mb-1.5">Score do sacado</div>
            <Segmented dark options={['AA', 'A', 'B', 'C']} value={input.score} onChange={(v) => setField('score', v)} />
          </div>
        </div>
        <div className="flex gap-6 pt-4.5 flex-wrap" style={{ borderTop: '1px solid rgba(255,255,255,0.14)' }}>
          <div>
            <div className="text-onNavy text-xs font-semibold">Taxa estimada</div>
            <div className="text-xl font-extrabold font-mono-num mt-1">{estimate?.rangeLabel}</div>
          </div>
          <div>
            <div className="text-onNavy text-xs font-semibold">Deságio estimado</div>
            <div className="text-xl font-extrabold font-mono-num mt-1">{estimate?.desagioFmt}</div>
          </div>
          <div>
            <div className="text-onNavy text-xs font-semibold">Valor líquido a receber</div>
            <div className="text-xl font-extrabold font-mono-num mt-1 text-onNavyBright">{estimate?.liquidoFmt}</div>
          </div>
        </div>
      </NavyCard>

      <Card className="p-7 mb-5">
        <div className="flex flex-col gap-5.5">
          {channels.map((ch) => (
            <div key={ch.label}>
              <div className="flex justify-between items-baseline mb-2">
                <div className="flex items-center gap-2">
                  <div className="font-bold text-[14px]">{ch.label}</div>
                  {ch.isLastro && <Badge variant="info" size="sm">LASTRO</Badge>}
                </div>
                <div className="font-mono-num font-bold text-sm">{ch.rangeLabel}</div>
              </div>
              <RangeBar leftPct={ch.leftPct} widthPct={ch.widthPct} color={ch.barColor} />
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-4" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Card className="p-5.5">
          <div className="font-bold text-[14px] mb-2.5">Por que o leilão comprime a taxa</div>
          <div className="text-textSecondary text-[13px] leading-relaxed">
            Quando vários financiadores disputam a mesma duplicata, a competição empurra o deságio para baixo — o mesmo efeito que a duplicata escritural amplia ao tornar o recebível
            auditável e negociável por qualquer instituição, não só pelo banco do sacado.
          </div>
        </Card>
        <Card className="p-5.5">
          <div className="font-bold text-[14px] mb-2.5">Escala do mercado endereçável</div>
          <div className="text-textSecondary text-[13px] leading-relaxed">
            O Banco Central estima um mercado potencial de R$ 10–11 trilhões/ano em recebíveis mercantis — hoje apenas 10–15% das duplicatas emitidas chegam ao mercado financeiro como
            garantia de crédito.
          </div>
        </Card>
      </div>
    </div>
  );
}
