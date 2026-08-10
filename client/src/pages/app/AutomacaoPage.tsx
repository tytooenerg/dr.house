import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { PageSkeleton } from '../../components/ui/Skeleton';
import { PageHeader, Card, NavyCard } from '../../components/ui/Card';
import { Toggle } from '../../components/ui/Toggle';
import { Input } from '../../components/ui/Input';
import { Segmented } from '../../components/ui/Segmented';
import { SelfServiceAgentCard } from '../../components/agents/SelfServiceAgentCard';

interface AutomationData {
  autoBidEnabled: boolean;
  autoBidRules: { scoreMin: string; taxaMax: string; exposicaoSacado: string; exposicaoMensal: string };
  diversification: { AA: number; A: number; B: number; C: number };
  sectorDiversification: { varejo: number; industria: number; construcao: number; servicos: number };
  autoBidActivity: { text: string; color: string; time: string }[];
  marketMakerEnabled: boolean;
  marketMakerMaxExposicao: string;
  marketMakerMinScore: string;
}

export function AutomacaoPage() {
  const [data, setData] = useState<AutomationData | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = () => api.get<AutomationData>('/automacao').then(setData);

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

  if (!data) return <PageSkeleton />;

  const toggle = () => api.post<AutomationData>('/automacao/toggle').then(setData);
  const setRule = (field: string, value: string) => api.post<AutomationData>('/automacao/rule', { field, value }).then(setData);
  const setDiv = (cls: string, value: number) => api.post<AutomationData>('/automacao/diversification', { cls, value }).then(setData);
  const setSector = (cls: string, value: number) => api.post<AutomationData>('/automacao/sector-diversification', { cls, value }).then(setData);
  const toggleMarketMaker = () => api.post<AutomationData>('/automacao/market-maker/toggle').then(setData);
  const setMarketMakerRule = (field: string, value: string) => api.post<AutomationData>('/automacao/market-maker/rule', { field, value }).then(setData);

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
              <div className="text-xs font-bold text-textSecondary mb-1.5">Taxa máxima a oferecer (% a.m.)</div>
              <Input mono value={data.autoBidRules.taxaMax} onChange={(e) => setRule('taxaMax', e.target.value)} />
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
            Toda vez que uma duplicata entra em leilão, a Lastro verifica o score do sacado e sua exposição atual contra os critérios acima. Se estiver dentro do parâmetro, um lance é
            enviado automaticamente com a menor taxa competitiva do momento — sem precisar de intervenção manual.
          </div>
          <div className="flex flex-col gap-2.5">
            {[
              'Verifica score do sacado em tempo real via API interna',
              'Respeita seu limite de exposição por sacado e mensal',
              'Nunca oferece acima da taxa máxima configurada',
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
