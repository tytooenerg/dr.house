import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { useMarketSocket } from '../../lib/useMarketSocket';
import { PageHeader } from '../../components/ui/Card';
import { Input, Select } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { AiTag } from '../../components/ui/Badge';

interface Insurer {
  key: string;
  name: string;
  premioFmt: string;
  selo: string;
}
interface Bid {
  name: string;
  initials: string;
  tipo: string;
  avatarBg: string;
  taxa: string;
  rateColor: string;
  borderColor: string;
  tag: string;
  tagBg: string;
  tagColor: string;
}
interface Offer {
  id: string;
  sacado: string;
  cedente: string;
  valor: number;
  valorFmt: string;
  desagio: string;
  vencimento: string;
  score: number;
  scoreBg: string;
  scoreColor: string;
  isBought: boolean;
  btnLabel: string;
  canBuy: boolean;
  bidCount: number;
  bids: Bid[];
  countdown: string;
  countdownSec: number;
  aceiteBadgeLabel: string;
  aceiteBadgeBg: string;
  aceiteBadgeColor: string;
  insurerInfo: Insurer | null;
  insurerOptions: Insurer[];
  aiMatch: boolean;
  aiMatchPct: string;
  aiSuggestedRate: string;
}

export function MarketplacePage() {
  const { offers: liveOffers, connected } = useMarketSocket<Offer>();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('taxa');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [insurerPickerFor, setInsurerPickerFor] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!insurerPickerFor) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setInsurerPickerFor(null);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [insurerPickerFor]);

  const offers = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = q ? liveOffers.filter((o) => o.sacado.toLowerCase().includes(q) || o.cedente.toLowerCase().includes(q)) : liveOffers.slice();
    if (sort === 'taxa') list.sort((a, b) => parseFloat(a.desagio) - parseFloat(b.desagio));
    else if (sort === 'score') list.sort((a, b) => b.score - a.score);
    else if (sort === 'valor') list.sort((a, b) => b.valor - a.valor);
    else if (sort === 'prazo') list.sort((a, b) => a.countdownSec - b.countdownSec);
    return list;
  }, [liveOffers, query, sort]);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const buy = async (id: string) => {
    setBusyId(id);
    try {
      await api.post(`/market/${id}/buy`);
    } finally {
      setBusyId(null);
    }
  };

  const insure = async (id: string, key: string | null) => {
    await api.post(`/market/${id}/insure`, { key });
    setInsurerPickerFor(null);
  };

  return (
    <div>
      <PageHeader
        title="Marketplace de Duplicatas"
        subtitle="Ofertas disponíveis para antecipação — compradores e cedentes"
        right={
          <span className="flex items-center gap-1.5 text-xs font-semibold text-textTertiary">
            <span className="rounded-full" style={{ width: 7, height: 7, background: connected ? '#0A5C36' : '#B8C2D4' }} />
            {connected ? 'Atualizações ao vivo' : 'Conectando…'}
          </span>
        }
      />

      <div className="flex gap-2.5 mb-4">
        <Input placeholder="Buscar por sacado ou cedente" value={query} onChange={(e) => setQuery(e.target.value)} className="max-w-[340px]" />
        <Select value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="taxa">Ordenar: melhor deságio</option>
          <option value="score">Ordenar: maior score</option>
          <option value="valor">Ordenar: maior valor</option>
          <option value="prazo">Ordenar: leilão fechando</option>
        </Select>
      </div>

      <div className="bg-white border border-border rounded-card overflow-hidden">
        <div
          className="grid gap-3 px-5 py-3.5 bg-[#F7F8FA] border-b border-border text-xs font-bold text-textSecondary uppercase tracking-wide"
          style={{ gridTemplateColumns: '1.3fr 0.9fr 0.8fr 0.7fr 0.8fr 1.6fr' }}
        >
          <div>Sacado</div>
          <div>Cedente</div>
          <div>Valor</div>
          <div>Deságio</div>
          <div>Vencimento</div>
          <div>Score / Aceite / Ação</div>
        </div>

        {offers.map((offer) => {
          const isExpanded = expanded.has(offer.id);
          return (
            <div key={offer.id} className="border-b border-border last:border-b-0">
              <div className="grid gap-3 px-5 py-4 items-center text-sm" style={{ gridTemplateColumns: '1.3fr 0.9fr 0.8fr 0.7fr 0.8fr 1.6fr' }}>
                <div>
                  <div className="font-semibold">{offer.sacado}</div>
                  {offer.aiMatch && <div className="text-[10.5px] font-bold text-blue mt-0.5">✦ Match de IA — {offer.aiMatchPct} aderente ao seu perfil</div>}
                </div>
                <div className="text-textSecondary">{offer.cedente}</div>
                <div className="font-bold font-mono-num">{offer.valorFmt}</div>
                <div className="text-green font-bold">{offer.desagio}</div>
                <div className="text-textSecondary">{offer.vencimento}</div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11.5px] font-bold px-2 py-1 rounded-md" style={{ background: offer.scoreBg, color: offer.scoreColor }}>
                    {offer.score}
                  </span>
                  <span className="text-[10.5px] font-bold px-1.5 py-1 rounded-md" style={{ background: offer.aceiteBadgeBg, color: offer.aceiteBadgeColor }}>
                    {offer.aceiteBadgeLabel}
                  </span>
                  <button
                    type="button"
                    onClick={() => toggleExpand(offer.id)}
                    className="px-3 py-1.5 rounded-md border border-inputBorder cursor-pointer text-[12.5px] font-bold bg-white text-navy"
                  >
                    {isExpanded ? 'Fechar leilão' : 'Ver leilão'}
                  </button>
                  <Button size="sm" disabled={!offer.canBuy || busyId === offer.id} onClick={() => buy(offer.id)}>
                    {busyId === offer.id ? 'Comprando…' : offer.btnLabel}
                  </Button>
                </div>
              </div>

              <div className="flex items-center gap-2.5 px-5 pb-3.5 relative flex-wrap">
                {offer.insurerInfo ? (
                  <>
                    <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-blue bg-[#E9EEFB] text-xs font-bold text-blue">
                      <span className="rounded-full bg-current" style={{ width: 7, height: 7 }} />
                      Segurada por {offer.insurerInfo.name}
                    </div>
                    <button type="button" className="bg-transparent border-none text-textTertiary text-[11.5px] font-bold cursor-pointer underline" onClick={() => insure(offer.id, null)}>
                      Trocar
                    </button>
                  </>
                ) : (
                  <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-inputBorder bg-bg text-xs font-bold text-textSecondary">
                    <span className="rounded-full border border-current" style={{ width: 7, height: 7 }} />
                    Sem cobertura de seguro
                  </div>
                )}
                <button
                  type="button"
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md cursor-pointer text-xs font-bold"
                  style={{
                    border: `1px solid ${offer.insurerInfo ? '#1E5EFF' : '#D6DCE5'}`,
                    background: offer.insurerInfo ? '#E9EEFB' : 'transparent',
                    color: offer.insurerInfo ? '#1E5EFF' : '#5B6472',
                  }}
                  onClick={() => setInsurerPickerFor(insurerPickerFor === offer.id ? null : offer.id)}
                >
                  <span className="rounded-full bg-current" style={{ width: 7, height: 7 }} />
                  {offer.insurerInfo ? 'Segurada ✓' : 'Contratar seguro'}
                </button>
                <div className="text-xs text-textSecondary">
                  {offer.insurerInfo ? `Segurada por ${offer.insurerInfo.name} — prêmio ${offer.insurerInfo.premioFmt}` : 'Proteção contra inadimplência disponível — compare seguradoras'}
                </div>

                {insurerPickerFor === offer.id && (
                  <div className="absolute top-[38px] left-0 z-20 w-80 bg-white border border-border rounded-xl shadow-dropdown overflow-hidden">
                    <div className="px-4 py-3 text-xs font-bold text-textSecondary border-b border-hairline">Comparar seguradoras parceiras</div>
                    {offer.insurerOptions.map((ins) => (
                      <button
                        key={ins.key}
                        type="button"
                        onClick={() => insure(offer.id, ins.key)}
                        className="w-full flex items-center justify-between gap-2.5 px-4 py-3 border-none bg-transparent cursor-pointer text-left border-b border-[#F5F7FA] last:border-b-0"
                      >
                        <div>
                          <div className="font-bold text-[13px] text-navy">{ins.name}</div>
                          <div className="text-textTertiary text-[11.5px] mt-0.5">{ins.selo}</div>
                        </div>
                        <div className="font-mono-num font-bold text-[13px] text-blue flex-shrink-0">{ins.premioFmt}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {isExpanded && (
                <div className="px-5 pb-4 pt-2.5 bg-[#F7F8FA]">
                  <div className="flex items-center justify-between pt-2.5 mb-2.5">
                    <div className="text-[11.5px] font-bold text-textSecondary uppercase tracking-wide">Leilão ao vivo — {offer.bidCount} financiadores disputando</div>
                    <div className="text-[11.5px] font-bold text-red font-mono-num">encerra em {offer.countdown}</div>
                  </div>
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-chip mb-2.5">
                    <AiTag />
                    <div className="text-xs text-navy">
                      Sugestão de abertura: <b>{offer.aiSuggestedRate}</b> a.m., com base em operações similares (mesmo setor, prazo e score)
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    {offer.bids.map((bid, i) => (
                      <div key={i} className="flex items-center gap-3.5 bg-white rounded-lg px-3.5 py-2.5" style={{ border: `1px solid ${bid.borderColor}` }}>
                        <div className="w-[26px] h-[26px] rounded-full text-white flex items-center justify-center text-[11px] font-bold flex-shrink-0" style={{ background: bid.avatarBg }}>
                          {bid.initials}
                        </div>
                        <div className="flex-1 text-[13.5px] font-semibold">{bid.name}</div>
                        <div className="text-[13px] text-textSecondary">{bid.tipo}</div>
                        <div className="text-sm font-extrabold font-mono-num" style={{ color: bid.rateColor }}>
                          {bid.taxa}
                        </div>
                        <div className="text-[11px] font-bold px-2 py-1 rounded-md min-w-[84px] text-center" style={{ background: bid.tagBg, color: bid.tagColor }}>
                          {bid.tag}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {offers.length === 0 && <EmptyState title="Nenhuma oferta encontrada" hint="Tente buscar por outro sacado ou cedente" />}
      </div>
    </div>
  );
}
