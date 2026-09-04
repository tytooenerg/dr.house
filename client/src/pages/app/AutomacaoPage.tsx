import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { PageSkeleton } from '../../components/ui/Skeleton';
import { PageHeader, Card, NavyCard } from '../../components/ui/Card';
import { Toggle } from '../../components/ui/Toggle';
import { Input } from '../../components/ui/Input';
import { Segmented } from '../../components/ui/Segmented';
import { ErrorState } from '../../components/ui/ErrorState';
import { SelfServiceAgentCard } from '../../components/agents/SelfServiceAgentCard';

type Rating = 'AA' | 'A' | 'B' | 'C';
type LadderField = 'taxaInicial' | 'taxaAlvo' | 'decrementoPorEtapa' | 'intervaloHoras';

interface LadderView {
  taxaInicial: number;
  taxaAlvo: number;
  decrementoPorEtapa: number;
  intervaloHoras: number;
  pisoAtualFmt: string;
  proximaQuedaEm: string | null;
  bandaAoVivo: { minFmt: string; maxFmt: string };
}

interface AutomationData {
  autoBidEnabled: boolean;
  autoBidRules: { scoreMin: string; exposicaoSacado: string; exposicaoMensal: string };
  ladder: Record<Rating, LadderView>;
  diversification: { AA: number; A: number; B: number; C: number };
  sectorDiversification: { varejo: number; industria: number; construcao: number; servicos: number };
  autoBidActivity: { text: string; color: string; time: string }[];
  marketMakerEnabled: boolean;
  marketMakerMaxExposicao: string;
  marketMakerMinScore: string;
}

const RATINGS: Rating[] = ['AA', 'A', 'B', 'C'];

function fmtHoursUntil(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'a qualquer momento';
  const totalMin = Math.round(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h${m > 0 ? ` ${m}min` : ''}` : `${m}min`;
}

export function AutomacaoPage() {
  const [data, setData] = useState<AutomationData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasLoadedOnce = useRef(false);
  // Rascunho local dos campos da escada, desacoplado de `data` — a tela faz polling a cada
  // 4s enquanto a automação está ligada, e um input controlado direto por `data` perderia o
  // que o usuário está digitando a cada resposta do poll. Só sincroniza com o servidor
  // no blur (commitLadder); enquanto o usuário edita, o valor mostrado é sempre o rascunho.
  const [ladderDraft, setLadderDraft] = useState<Record<string, string>>({});

  // Erro de carga só bloqueia a tela na primeira carga — depois disso a página faz polling
  // (autoBidEnabled) a cada 4s, e uma falha isolada nesse polling não deve derrubar uma
  // tela que já estava funcionando; ela só tenta de novo no próximo ciclo.
  const load = () =>
    api
      .get<AutomationData>('/automacao')
      .then((d) => {
        setData(d);
        setLoadError(null);
        hasLoadedOnce.current = true;
      })
      .catch((err) => {
        if (!hasLoadedOnce.current) setLoadError(err instanceof ApiError ? err.message : 'Falha ao carregar Automação de Lances.');
      });

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (data?.autoBidEnabled) {
      pollRef.current = setInterval(load, 4000);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.autoBidEnabled]);

  if (loadError) return <ErrorState message={loadError} onRetry={load} />;
  if (!data) return <PageSkeleton />;

  const toggle = () => api.post<AutomationData>('/automacao/toggle').then(setData);
  const setRule = (field: string, value: string) => api.post<AutomationData>('/automacao/rule', { field, value }).then(setData);
  const setDiv = (cls: string, value: number) => api.post<AutomationData>('/automacao/diversification', { cls, value }).then(setData);
  const setSector = (cls: string, value: number) => api.post<AutomationData>('/automacao/sector-diversification', { cls, value }).then(setData);
  const toggleMarketMaker = () => api.post<AutomationData>('/automacao/market-maker/toggle').then(setData);
  const setMarketMakerRule = (field: string, value: string) => api.post<AutomationData>('/automacao/market-maker/rule', { field, value }).then(setData);

  const ladderKey = (rating: Rating, field: LadderField) => `${rating}-${field}`;
  const ladderInputValue = (rating: Rating, field: LadderField) => {
    const key = ladderKey(rating, field);
    if (key in ladderDraft) return ladderDraft[key];
    return String(data.ladder[rating][field]).replace('.', ',');
  };
  const editLadder = (rating: Rating, field: LadderField, value: string) => setLadderDraft((prev) => ({ ...prev, [ladderKey(rating, field)]: value }));
  const commitLadder = (rating: Rating, field: LadderField) => {
    const key = ladderKey(rating, field);
    const raw = ladderDraft[key];
    if (raw === undefined) return;
    const parsed = parseFloat(raw.replace(',', '.'));
    const clearDraft = () => setLadderDraft((prev) => { const next = { ...prev }; delete next[key]; return next; });
    if (!Number.isFinite(parsed)) {
      clearDraft(); // inválido — volta a mostrar o valor real do servidor
      return;
    }
    api
      .post<AutomationData>('/automacao/ladder', { rating, field, value: parsed })
      .then((d) => {
        setData(d);
        clearDraft();
      })
      .catch(clearDraft);
  };

  const divTotal = data.diversification.AA + data.diversification.A + data.diversification.B + data.diversification.C;
  const sectorTotal = data.sectorDiversification.varejo + data.sectorDiversification.industria + data.sectorDiversification.construcao + data.sectorDiversification.servicos;

  return (
    <div>
      <PageHeader title="Automação de Lances" subtitle="Configure regras e deixe a Lastro dar lances por você em ofertas que atendem seus critérios de risco" />

      <NavyCard className="flex items-center justify-between gap-4 flex-wrap mb-4">
        <div className="flex items-center gap-3.5">
          <Toggle on={data.autoBidEnabled} onClick={toggle} size="lg" />
          <div className="text-white font-bold text-[15px]">Lance automático</div>
        </div>
        <div className="text-[13px] font-semibold" style={{ color: data.autoBidEnabled ? '#6FCF97' : '#8B97AC' }}>
          {data.autoBidEnabled ? 'Automação ativa — participando dos leilões que atendem seus critérios' : 'Automação desligada — você só participa manualmente'}
        </div>
      </NavyCard>

      <div className="mb-4">
        <SelfServiceAgentCard
          agentId="autobid"
          title="Agente de Auto-Bid (IA)"
          placeholder="Ex: avalie a oferta dup_9f2a contra minhas regras e compre se estiver dentro do meu perfil de risco"
        />
      </div>

      <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Card>
          <div className="font-bold text-[15px] mb-4">Critérios de risco</div>
          <div className="flex flex-col gap-4">
            <div>
              <div className="text-xs font-bold text-textSecondary mb-2">Score mínimo aceito do sacado</div>
              <Segmented options={['AA', 'A', 'B', 'C']} value={data.autoBidRules.scoreMin} onChange={(v) => setRule('scoreMin', v)} />
            </div>
            <div>
              <div className="text-xs font-bold text-textSecondary mb-1.5">Exposição máxima por sacado (R$)</div>
              <Input mono value={data.autoBidRules.exposicaoSacado} onChange={(e) => setRule('exposicaoSacado', e.target.value)} />
            </div>
            <div>
              <div className="text-xs font-bold text-textSecondary mb-1.5">Limite de exposição mensal (R$)</div>
              <Input mono value={data.autoBidRules.exposicaoMensal} onChange={(e) => setRule('exposicaoMensal', e.target.value)} />
            </div>
          </div>
        </Card>

        <Card>
          <div className="font-bold text-[15px] mb-1.5">Como funciona</div>
          <div className="text-textSecondary text-[13.5px] leading-relaxed mb-4.5">
            Toda vez que uma duplicata entra em leilão, a Lastro verifica o score do sacado e sua exposição atual contra os critérios acima e o piso atual da escada de lances
            (abaixo) pra essa classe de rating. Se estiver dentro do parâmetro, a compra acontece automaticamente — sem precisar de intervenção manual.
          </div>
          <div className="flex flex-col gap-2.5">
            {[
              'Verifica score do sacado em tempo real via API interna',
              'Respeita seu limite de exposição por sacado e mensal',
              'Só compra quando o deságio da oferta atinge o piso atual da escada da classe',
            ].map((t) => (
              <div key={t} className="flex items-center gap-2.5 text-[13px]">
                <span className="rounded-full bg-blue flex-shrink-0" style={{ width: 6, height: 6 }} />
                {t}
              </div>
            ))}
            <div className="flex items-center gap-2.5 text-[13px]">
              <span className="rounded-full bg-blue flex-shrink-0" style={{ width: 6, height: 6 }} />
              Também disponível via API: <span className="font-mono-num">POST /v1/leiloes/:id/lances</span>
            </div>
          </div>
        </Card>
      </div>

      <Card className="mb-4">
        <div className="font-bold text-[15px] mb-1.5">Escada de lances por classe de rating</div>
        <div className="text-textSecondary text-[12.5px] mb-4.5">
          Pra cada classe, a automação começa exigindo o melhor deságio possível (taxa inicial) e vai relaxando essa exigência ao longo do tempo — um degrau de "decremento por
          etapa" a cada "intervalo em horas" sem fechar negócio — até parar num piso mínimo (taxa alvo). Uma compra na classe rearma a escada, que volta a ficar exigente. Deixe em
          branco pra usar a banda de mercado ao vivo. Só aparecem aqui as classes com alocação {'>'} 0% na diversificação abaixo.
        </div>
        <div className="flex flex-col gap-4">
          {RATINGS.filter((r) => data.diversification[r] > 0).map((rating) => {
            const l = data.ladder[rating];
            return (
              <div key={rating} className="border border-border rounded-lg p-3.5">
                <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
                  <div className="font-bold text-[13.5px]">Rating {rating}</div>
                  <div className="text-[12px] text-textSecondary">
                    Banda de mercado hoje: <span className="font-mono-num">{l.bandaAoVivo.minFmt}–{l.bandaAoVivo.maxFmt}</span>
                  </div>
                </div>
                <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
                  <div>
                    <div className="text-xs font-bold text-textSecondary mb-1.5">Taxa inicial (% a.m.)</div>
                    <Input
                      mono
                      placeholder={l.bandaAoVivo.maxFmt}
                      value={ladderInputValue(rating, 'taxaInicial')}
                      onChange={(e) => editLadder(rating, 'taxaInicial', e.target.value)}
                      onBlur={() => commitLadder(rating, 'taxaInicial')}
                    />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-textSecondary mb-1.5">Taxa alvo / piso (% a.m.)</div>
                    <Input
                      mono
                      placeholder={l.bandaAoVivo.minFmt}
                      value={ladderInputValue(rating, 'taxaAlvo')}
                      onChange={(e) => editLadder(rating, 'taxaAlvo', e.target.value)}
                      onBlur={() => commitLadder(rating, 'taxaAlvo')}
                    />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-textSecondary mb-1.5">Decremento por etapa (p.p.)</div>
                    <Input
                      mono
                      value={ladderInputValue(rating, 'decrementoPorEtapa')}
                      onChange={(e) => editLadder(rating, 'decrementoPorEtapa', e.target.value)}
                      onBlur={() => commitLadder(rating, 'decrementoPorEtapa')}
                    />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-textSecondary mb-1.5">Intervalo entre etapas (h)</div>
                    <Input
                      mono
                      value={ladderInputValue(rating, 'intervaloHoras')}
                      onChange={(e) => editLadder(rating, 'intervaloHoras', e.target.value)}
                      onBlur={() => commitLadder(rating, 'intervaloHoras')}
                    />
                  </div>
                </div>
                <div className="text-[12.5px] font-bold mt-3" style={{ color: '#0A5C36' }}>
                  Piso atual: {l.pisoAtualFmt}
                  {l.proximaQuedaEm && <span className="text-textSecondary font-normal"> · próxima queda em {fmtHoursUntil(l.proximaQuedaEm)}</span>}
                </div>
              </div>
            );
          })}
          {RATINGS.every((r) => data.diversification[r] === 0) && (
            <div className="text-[13px] text-textSecondary">Nenhuma classe com alocação — ajuste a diversificação abaixo pra configurar a escada.</div>
          )}
        </div>
      </Card>

      <Card className="mb-4">
        <div className="flex items-center justify-between gap-4 flex-wrap mb-1">
          <div className="flex items-center gap-3">
            <Toggle on={data.marketMakerEnabled} onClick={toggleMarketMaker} size="lg" />
            <div className="font-bold text-[15px]">Market Maker (fornecer liquidez)</div>
          </div>
          <div className="text-[12.5px] font-semibold" style={{ color: data.marketMakerEnabled ? '#0A5C36' : '#8B97AC' }}>
            {data.marketMakerEnabled ? 'Ativo — dando lances em anúncios sem liquidez a cada 6h' : 'Desligado'}
          </div>
        </div>
        <div className="text-textSecondary text-[12.5px] mb-4">
          Um agente de IA (`market_maker`) varre o mercado secundário periodicamente e propõe lances em anúncios de outros investidores que ainda não têm nenhum lance, dentro do
          score mínimo e do limite de exposição abaixo. Cada lance proposto ainda precisa da sua aprovação em Agentes IA — nada compromete capital sem você confirmar.
        </div>
        <div className="grid gap-3.5" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div>
            <div className="text-xs font-bold text-textSecondary mb-1.5">Score mínimo do sacado para dar liquidez</div>
            <Input mono value={data.marketMakerMinScore} onChange={(e) => setMarketMakerRule('marketMakerMinScore', e.target.value)} />
          </div>
          <div>
            <div className="text-xs font-bold text-textSecondary mb-1.5">Exposição máxima em lances de liquidez (R$)</div>
            <Input mono value={data.marketMakerMaxExposicao} onChange={(e) => setMarketMakerRule('marketMakerMaxExposicao', e.target.value)} />
          </div>
        </div>
        {data.marketMakerEnabled && (
          <div className="mt-4">
            <SelfServiceAgentCard
              agentId="market_maker"
              title="Agente Market Maker (IA)"
              placeholder="Ex: avalie os anúncios sem lance no mercado secundário e proponha lances de liquidez dentro do meu limite"
            />
          </div>
        )}
      </Card>

      <Card className="mb-4">
        <div className="flex items-center justify-between mb-1 flex-wrap gap-2.5">
          <div className="font-bold text-[15px]">Diversificação por classe de risco</div>
          <div className="text-[12.5px] font-bold" style={{ color: divTotal === 100 ? '#0A5C36' : '#B03A2E' }}>
            {divTotal === 100 ? 'Alocação balanceada (100%)' : `Ajuste para somar 100% — atual: ${divTotal}%`}
          </div>
        </div>
        <div className="text-textSecondary text-[12.5px] mb-4.5">Distribua o quanto do seu capital automatizado vai para cada faixa de score — a automação prioriza ofertas proporcionalmente a essa alocação</div>
        <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          {(['AA', 'A', 'B', 'C'] as const).map((cls) => (
            <div key={cls}>
              <div className="flex justify-between mb-1.5">
                <span className="text-[12.5px] font-bold">Score {cls}</span>
                <span className="text-[12.5px] font-bold font-mono-num">{data.diversification[cls]}%</span>
              </div>
              <input type="range" min={0} max={100} value={data.diversification[cls]} onChange={(e) => setDiv(cls, Number(e.target.value))} className="w-full" />
            </div>
          ))}
        </div>
      </Card>

      <Card className="mb-4">
        <div className="flex items-center justify-between mb-1 flex-wrap gap-2.5">
          <div className="font-bold text-[15px]">Diversificação por setor do sacado</div>
          <div className="text-[12.5px] font-bold" style={{ color: sectorTotal === 100 ? '#0A5C36' : '#B03A2E' }}>
            {sectorTotal === 100 ? 'Alocação balanceada (100%)' : `Ajuste para somar 100% — atual: ${sectorTotal}%`}
          </div>
        </div>
        <div className="text-textSecondary text-[12.5px] mb-4.5">Evite concentração num único setor da economia, mesmo dentro da mesma faixa de score</div>
        <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          {(
            [
              ['varejo', 'Varejo'],
              ['industria', 'Indústria'],
              ['construcao', 'Construção'],
              ['servicos', 'Serviços'],
            ] as const
          ).map(([key, label]) => (
            <div key={key}>
              <div className="flex justify-between mb-1.5">
                <span className="text-[12.5px] font-bold">{label}</span>
                <span className="text-[12.5px] font-bold font-mono-num">{data.sectorDiversification[key]}%</span>
              </div>
              <input type="range" min={0} max={100} value={data.sectorDiversification[key]} onChange={(e) => setSector(key, Number(e.target.value))} className="w-full" />
            </div>
          ))}
        </div>
      </Card>

      <div className="bg-white border border-border rounded-card overflow-hidden">
        <div className="px-5 py-4.5 font-bold text-[15px] border-b border-border">Atividade da automação</div>
        {data.autoBidActivity.map((act, i) => (
          <div key={i} className="flex items-start gap-2.5 px-5 py-3.5 border-b border-hairline last:border-b-0">
            <span className="rounded-full mt-1.5 flex-shrink-0" style={{ width: 7, height: 7, background: act.color }} />
            <div className="flex-1 text-[13.5px] leading-snug">{act.text}</div>
            <div className="text-xs text-textTertiary flex-shrink-0">{act.time}</div>
          </div>
        ))}
        {data.autoBidActivity.length === 0 && <div className="px-5 py-6 text-sm text-textSecondary">Nenhuma atividade ainda — ative o lance automático para começar.</div>}
      </div>
    </div>
  );
}
