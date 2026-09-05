import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { useMarketSocket } from '../../lib/useMarketSocket';
import { PageHeader } from '../../components/ui/Card';
import { Input, Select } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { AiTag, Badge } from '../../components/ui/Badge';
import { useLang } from '../../lib/i18n';
import { PALETTE, SECTOR_COLORS } from '../../lib/palette';

interface Insurer {
  key: string;
  name: string;
  premioFmt: string;
  selo: string;
  recommended?: boolean;
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
interface ExplanationFactor {
  label: string;
  valor: string;
  peso: 'alto' | 'médio' | 'informativo';
}
interface FundingExplanation {
  duplicataId: string;
  rating: string;
  factors: ExplanationFactor[];
  resumo: string;
  narrativaIA: string | null;
}

interface FractionalOffering {
  duplicataId: string;
  totalTokens: number;
  tokenValorFmt: string;
  tokensVendidos: number;
  tokensRestantes: number;
  pctVendido: number;
  status: 'aberta' | 'concluida';
  holdersCount: number;
}
// Mirrors server FRACTIONAL_MIN_VALOR (lib/fractionalOfferings.ts) — only offers at or
// above this face value are eligible for tokenização.
const FRACTIONAL_MIN_VALOR = 150000;

// Mirrors server lib/riscoCore.ts's Setor union + SETOR_LABELS — a fixed, small enum, not
// worth a round-trip to fetch a catalog for.
const SETOR_OPTIONS: { value: string; label: string }[] = [
  { value: 'varejo', label: 'Varejo' },
  { value: 'atacado', label: 'Atacado' },
  { value: 'comercio', label: 'Comércio' },
  { value: 'industria', label: 'Indústria' },
  { value: 'construcao', label: 'Construção' },
  { value: 'servicos', label: 'Serviços' },
];
// One color per class so the badge is scannable at a glance across a long list of offers —
// distinct from the score/rating colors (green/amber/red), which mean risk, not business type.
const SETOR_STYLE = SECTOR_COLORS;
const RATING_OPTIONS = ['AA', 'A', 'B', 'C'];

interface Offer {
  id: string;
  sacado: string;
  cedente: string;
  valor: number;
  valorFmt: string;
  desagio: string;
  precoCompraFmt: string;
  vencimento: string;
  prazoDias: number;
  setor: string | null;
  setorLabel: string | null;
  score: number;
  rating: string;
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
  const { t } = useLang();
  const { offers: liveOffers, connected } = useMarketSocket<Offer>();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('taxa');
  const [setorFilter, setSetorFilter] = useState('');
  const [ratingFilter, setRatingFilter] = useState('');
  const [valorMin, setValorMin] = useState('');
  const [valorMax, setValorMax] = useState('');
  const [prazoMin, setPrazoMin] = useState('');
  const [prazoMax, setPrazoMax] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [insurerPickerFor, setInsurerPickerFor] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [fractionalPickerFor, setFractionalPickerFor] = useState<string | null>(null);
  const [fractionalOffering, setFractionalOffering] = useState<FractionalOffering | null>(null);
  const [fractionalTokensInput, setFractionalTokensInput] = useState('');
  const [fractionalBusy, setFractionalBusy] = useState(false);
  const [fractionalError, setFractionalError] = useState('');
  const [explainFor, setExplainFor] = useState<string | null>(null);
  const [explanation, setExplanation] = useState<FundingExplanation | null>(null);
  const [explainLoading, setExplainLoading] = useState(false);

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
    const vMin = valorMin.trim() ? Number(valorMin) : null;
    const vMax = valorMax.trim() ? Number(valorMax) : null;
    const pMin = prazoMin.trim() ? Number(prazoMin) : null;
    const pMax = prazoMax.trim() ? Number(prazoMax) : null;
    let list = liveOffers.filter((o) => {
      if (q && !o.sacado.toLowerCase().includes(q) && !o.cedente.toLowerCase().includes(q)) return false;
      if (setorFilter && o.setor !== setorFilter) return false;
      if (ratingFilter && o.rating !== ratingFilter) return false;
      if (vMin !== null && Number.isFinite(vMin) && o.valor < vMin) return false;
      if (vMax !== null && Number.isFinite(vMax) && o.valor > vMax) return false;
      if (pMin !== null && Number.isFinite(pMin) && o.prazoDias < pMin) return false;
      if (pMax !== null && Number.isFinite(pMax) && o.prazoDias > pMax) return false;
      return true;
    });
    if (sort === 'taxa') list.sort((a, b) => parseFloat(a.desagio) - parseFloat(b.desagio));
    else if (sort === 'score') list.sort((a, b) => b.score - a.score);
    else if (sort === 'valor') list.sort((a, b) => b.valor - a.valor);
    else if (sort === 'prazo') list.sort((a, b) => a.countdownSec - b.countdownSec);
    return list;
  }, [liveOffers, query, sort, setorFilter, ratingFilter, valorMin, valorMax, prazoMin, prazoMax]);

  const hasActiveFilters = !!(setorFilter || ratingFilter || valorMin || valorMax || prazoMin || prazoMax);
  const clearFilters = () => {
    setSetorFilter('');
    setRatingFilter('');
    setValorMin('');
    setValorMax('');
    setPrazoMin('');
    setPrazoMax('');
  };

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

  const openFractionalPicker = async (id: string) => {
    setFractionalError('');
    setFractionalTokensInput('');
    setFractionalPickerFor(fractionalPickerFor === id ? null : id);
    if (fractionalPickerFor !== id) {
      const res = await api.get<{ eligible: boolean; reason: string | null; offering: FractionalOffering | null }>(`/market/${id}/fracionamento`);
      setFractionalOffering(res.offering);
    }
  };

  const buyFractionalTokens = async (id: string) => {
    setFractionalError('');
    const tokens = Number(fractionalTokensInput);
    if (!Number.isInteger(tokens) || tokens <= 0) {
      setFractionalError('Informe uma quantidade válida de tokens.');
      return;
    }
    setFractionalBusy(true);
    try {
      const res = await api.post<{ offering: FractionalOffering }>(`/market/${id}/fracionar`, { tokens });
      setFractionalOffering(res.offering);
      setFractionalTokensInput('');
    } catch (err) {
      setFractionalError(err instanceof ApiError ? err.message : 'Não foi possível comprar os tokens.');
    } finally {
      setFractionalBusy(false);
    }
  };

  const toggleExplain = async (id: string) => {
    if (explainFor === id) {
      setExplainFor(null);
      return;
    }
    setExplainFor(id);
    setExplanation(null);
    setExplainLoading(true);
    try {
      const data = await api.get<FundingExplanation>(`/market/${id}/explicacao`);
      setExplanation(data);
    } finally {
      setExplainLoading(false);
    }
  };

  return (
    <div>
      <PageHeader
        title={t('marketplace.title', 'Marketplace de Duplicatas')}
        subtitle={t('marketplace.subtitle', 'Ofertas disponíveis para antecipação — compradores e cedentes')}
        right={
          <span className="flex items-center gap-1.5 text-xs font-semibold text-textTertiary">
            <span className="rounded-full" style={{ width: 7, height: 7, background: connected ? PALETTE.green : PALETTE.onNavyDim }} />
            {connected ? t('marketplace.liveUpdates', 'Atualizações ao vivo') : t('marketplace.connecting', 'Conectando…')}
          </span>
        }
      />

      <div className="flex gap-2.5 mb-2.5 flex-wrap">
        <Input placeholder={t('marketplace.searchPlaceholder', 'Buscar por sacado ou cedente')} value={query} onChange={(e) => setQuery(e.target.value)} className="max-w-[340px]" />
        <Select value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="taxa">{t('marketplace.sortRate', 'Ordenar: melhor deságio')}</option>
          <option value="score">{t('marketplace.sortScore', 'Ordenar: maior score')}</option>
          <option value="valor">{t('marketplace.sortValue', 'Ordenar: maior valor')}</option>
          <option value="prazo">{t('marketplace.sortDeadline', 'Ordenar: leilão fechando')}</option>
        </Select>
      </div>

      <div className="flex gap-2.5 mb-4 flex-wrap items-center">
        <Select value={setorFilter} onChange={(e) => setSetorFilter(e.target.value)}>
          <option value="">{t('marketplace.filterSector', 'Setor: todos')}</option>
          {SETOR_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
        <Select value={ratingFilter} onChange={(e) => setRatingFilter(e.target.value)}>
          <option value="">{t('marketplace.filterRating', 'Rating: todos')}</option>
          {RATING_OPTIONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </Select>
        <div className="flex items-center gap-1.5">
          <Input type="number" placeholder={t('marketplace.valueMin', 'Valor mín.')} value={valorMin} onChange={(e) => setValorMin(e.target.value)} className="w-[120px]" />
          <span className="text-textTertiary text-xs">–</span>
          <Input type="number" placeholder={t('marketplace.valueMax', 'Valor máx.')} value={valorMax} onChange={(e) => setValorMax(e.target.value)} className="w-[120px]" />
        </div>
        <div className="flex items-center gap-1.5">
          <Input type="number" placeholder={t('marketplace.prazoMin', 'Prazo mín. (dias)')} value={prazoMin} onChange={(e) => setPrazoMin(e.target.value)} className="w-[140px]" />
          <span className="text-textTertiary text-xs">–</span>
          <Input type="number" placeholder={t('marketplace.prazoMax', 'Prazo máx. (dias)')} value={prazoMax} onChange={(e) => setPrazoMax(e.target.value)} className="w-[140px]" />
        </div>
        {hasActiveFilters && (
          <Button size="sm" variant="secondary" onClick={clearFilters}>
            {t('marketplace.clearFilters', 'Limpar filtros')}
          </Button>
        )}
      </div>

      <div className="bg-white border border-border rounded-card overflow-hidden">
        <div
          className="grid gap-3 px-5 py-3.5 bg-surface border-b border-border text-xs font-bold text-textSecondary uppercase tracking-wide"
          style={{ gridTemplateColumns: '1.3fr 0.9fr 0.8fr 0.7fr 0.8fr 1.6fr' }}
        >
          <div>{t('marketplace.colSacado', 'Sacado')}</div>
          <div>{t('marketplace.colCedente', 'Cedente')}</div>
          <div>{t('marketplace.colValor', 'Valor')}</div>
          <div>{t('marketplace.colDesagio', 'Deságio')}</div>
          <div>{t('marketplace.colVencimento', 'Vencimento')}</div>
          <div>{t('marketplace.colAction', 'Score / Aceite / Ação')}</div>
        </div>

        {offers.map((offer) => {
          const isExpanded = expanded.has(offer.id);
          return (
            <div key={offer.id} className="border-b border-border last:border-b-0">
              <div className="grid gap-3 px-5 py-4 items-center text-sm" style={{ gridTemplateColumns: '1.3fr 0.9fr 0.8fr 0.7fr 0.8fr 1.6fr' }}>
                <div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-semibold">{offer.sacado}</span>
                    {offer.setor && offer.setorLabel && (
                      <Badge label={offer.setorLabel} bg={SETOR_STYLE[offer.setor]?.bg ?? PALETTE.hairline} color={SETOR_STYLE[offer.setor]?.color ?? PALETTE.textSecondary} className="text-[10.5px] px-2 py-0.5" />
                    )}
                  </div>
                  {offer.aiMatch && <div className="text-[10.5px] font-bold text-blue mt-0.5">✦ Match de IA — {offer.aiMatchPct} aderente ao seu perfil</div>}
                </div>
                <div className="text-textSecondary">{offer.cedente}</div>
                <div>
                  <div className="font-bold font-mono-num">{offer.valorFmt}</div>
                  <div className="text-[11.5px] text-textTertiary font-mono-num" title="Preço com deságio — o que você paga agora; recebe o valor de face de volta no vencimento">
                    Você paga {offer.precoCompraFmt}
                  </div>
                </div>
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
                    {isExpanded ? t('marketplace.closeAuction', 'Fechar leilão') : t('marketplace.viewAuction', 'Ver leilão')}
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleExplain(offer.id)}
                    className="px-3 py-1.5 rounded-md border border-inputBorder cursor-pointer text-[12.5px] font-bold bg-white text-blue"
                  >
                    {explainFor === offer.id ? 'Fechar explicação' : 'Por que essa oferta?'}
                  </button>
                  <Button size="sm" disabled={!offer.canBuy || busyId === offer.id} onClick={() => buy(offer.id)}>
                    {busyId === offer.id ? t('marketplace.buying', 'Comprando…') : offer.btnLabel}
                  </Button>
                </div>
              </div>

              <div className="flex items-center gap-2.5 px-5 pb-3.5 relative flex-wrap">
                {offer.insurerInfo ? (
                  <>
                    <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-blue bg-chip text-xs font-bold text-blue">
                      <span className="rounded-full bg-current" style={{ width: 7, height: 7 }} />
                      Segurada por {offer.insurerInfo.name}
                    </div>
                    <button type="button" className="bg-transparent border-none text-textTertiary text-[11.5px] font-bold cursor-pointer underline" onClick={() => insure(offer.id, null)}>
                      {t('marketplace.swap', 'Trocar')}
                    </button>
                  </>
                ) : (
                  <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-inputBorder bg-bg text-xs font-bold text-textSecondary">
                    <span className="rounded-full border border-current" style={{ width: 7, height: 7 }} />
                    {t('marketplace.noInsurance', 'Sem cobertura de seguro')}
                  </div>
                )}
                <button
                  type="button"
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md cursor-pointer text-xs font-bold"
                  style={{
                    border: `1px solid ${offer.insurerInfo ? PALETTE.blue : PALETTE.inputBorder}`,
                    background: offer.insurerInfo ? PALETTE.chip : 'transparent',
                    color: offer.insurerInfo ? PALETTE.blue : PALETTE.textSecondary,
                  }}
                  onClick={() => setInsurerPickerFor(insurerPickerFor === offer.id ? null : offer.id)}
                >
                  <span className="rounded-full bg-current" style={{ width: 7, height: 7 }} />
                  {offer.insurerInfo ? t('marketplace.insured', 'Segurada ✓') : t('marketplace.getInsurance', 'Contratar seguro')}
                </button>
                <div className="text-xs text-textSecondary">
                  {offer.insurerInfo ? `Segurada por ${offer.insurerInfo.name} — prêmio ${offer.insurerInfo.premioFmt}` : t('marketplace.insuranceHint', 'Proteção contra inadimplência disponível — compare seguradoras')}
                </div>

                {insurerPickerFor === offer.id && (
                  <div className="absolute top-[38px] left-0 z-20 w-80 bg-white border border-border rounded-xl shadow-dropdown overflow-hidden">
                    <div className="px-4 py-3 text-xs font-bold text-textSecondary border-b border-hairline">
                      {t('marketplace.liveQuotesHint', 'Cotações em tempo real — cada seguradora precifica este risco de forma diferente')}
                    </div>
                    {offer.insurerOptions.map((ins) => (
                      <button
                        key={ins.key}
                        type="button"
                        onClick={() => insure(offer.id, ins.key)}
                        className="w-full flex items-center justify-between gap-2.5 px-4 py-3 border-none bg-transparent cursor-pointer text-left border-b border-bg last:border-b-0"
                      >
                        <div>
                          <div className="font-bold text-[13px] text-navy flex items-center gap-1.5">
                            {ins.name}
                            {ins.recommended && (
                              <span className="text-[10.5px] font-bold px-1.5 py-0.5 rounded bg-greenBg text-green">{t('marketplace.bestQuote', 'Melhor cotação')}</span>
                            )}
                          </div>
                          <div className="text-textTertiary text-[11.5px] mt-0.5">{ins.selo}</div>
                        </div>
                        <div className="font-mono-num font-bold text-[13px] text-blue flex-shrink-0">{ins.premioFmt}</div>
                      </button>
                    ))}
                  </div>
                )}

                {offer.valor >= FRACTIONAL_MIN_VALOR && offer.canBuy && (
                  <button
                    type="button"
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md cursor-pointer text-xs font-bold border border-inputBorder bg-white text-navy"
                    onClick={() => openFractionalPicker(offer.id)}
                  >
                    {t('marketplace.fractionalize', 'Fracionar')}
                  </button>
                )}
                {fractionalPickerFor === offer.id && (
                  <div className="absolute top-[38px] left-0 z-20 w-96 bg-white border border-border rounded-xl shadow-dropdown p-4">
                    <div className="text-xs font-bold text-textSecondary mb-2">
                      Tokenização — cada token representa {fractionalOffering ? Math.round(100 / fractionalOffering.totalTokens) : 1}% do valor de face
                    </div>
                    {fractionalOffering ? (
                      <>
                        <div className="text-[12.5px] mb-2">
                          {fractionalOffering.tokensVendidos}/{fractionalOffering.totalTokens} tokens vendidos ({fractionalOffering.pctVendido}%) —{' '}
                          {fractionalOffering.holdersCount} investidor(es) — {fractionalOffering.tokenValorFmt}/token
                        </div>
                        {fractionalOffering.status === 'concluida' ? (
                          <div className="text-[12.5px] font-bold text-green">{t('marketplace.fullyAllocated', 'Totalmente alocada.')}</div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <Input
                              placeholder={`até ${fractionalOffering.tokensRestantes} tokens`}
                              value={fractionalTokensInput}
                              onChange={(e) => setFractionalTokensInput(e.target.value)}
                              className="flex-1"
                            />
                            <Button size="sm" disabled={fractionalBusy} onClick={() => buyFractionalTokens(offer.id)}>
                              {fractionalBusy ? t('marketplace.buying', 'Comprando…') : t('marketplace.buyTokens', 'Comprar tokens')}
                            </Button>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="flex items-center gap-2">
                        <Input placeholder={t('marketplace.tokenQtyPlaceholder', 'quantidade de tokens')} value={fractionalTokensInput} onChange={(e) => setFractionalTokensInput(e.target.value)} className="flex-1" />
                        <Button size="sm" disabled={fractionalBusy} onClick={() => buyFractionalTokens(offer.id)}>
                          {fractionalBusy ? t('marketplace.buying', 'Comprando…') : t('marketplace.buyTokens', 'Comprar tokens')}
                        </Button>
                      </div>
                    )}
                    {fractionalError && <div className="mt-2 text-red text-[12.5px] font-semibold">{fractionalError}</div>}
                  </div>
                )}
              </div>

              {explainFor === offer.id && (
                <div className="px-5 pb-4 pt-2.5 bg-surface">
                  <div className="flex items-center gap-2 mb-2.5">
                    <AiTag label="Explicabilidade" />
                    <div className="text-[11.5px] font-bold text-textSecondary uppercase tracking-wide">Por que essa oferta tem esse preço</div>
                  </div>
                  {explainLoading || !explanation ? (
                    <div className="text-[12.5px] text-textSecondary">Analisando os fatores da oferta…</div>
                  ) : (
                    <>
                      <p className="text-[13px] text-navy mb-3">{explanation.resumo}</p>
                      <div className="flex flex-col gap-1.5 mb-3">
                        {explanation.factors.map((f) => (
                          <div key={f.label} className="flex items-center justify-between gap-3 text-[12.5px] bg-white rounded-lg px-3 py-2 border border-border">
                            <span className="text-textSecondary">{f.label}</span>
                            <span className="font-semibold text-right">{f.valor}</span>
                          </div>
                        ))}
                      </div>
                      {explanation.narrativaIA && (
                        <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-chip">
                          <AiTag />
                          <div className="text-xs text-navy">{explanation.narrativaIA}</div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {isExpanded && (
                <div className="px-5 pb-4 pt-2.5 bg-surface">
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
                        <div className="w-[26px] h-[26px] rounded-full text-white flex items-center justify-center text-[11.5px] font-bold flex-shrink-0" style={{ background: bid.avatarBg }}>
                          {bid.initials}
                        </div>
                        <div className="flex-1 text-[13px] font-semibold">{bid.name}</div>
                        <div className="text-[13px] text-textSecondary">{bid.tipo}</div>
                        <div className="text-sm font-extrabold font-mono-num" style={{ color: bid.rateColor }}>
                          {bid.taxa}
                        </div>
                        <div className="text-[11.5px] font-bold px-2 py-1 rounded-md min-w-[84px] text-center" style={{ background: bid.tagBg, color: bid.tagColor }}>
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

        {offers.length === 0 && <EmptyState title={t('marketplace.emptyTitle', 'Nenhuma oferta encontrada')} hint={t('marketplace.emptyHint', 'Tente buscar por outro sacado ou cedente')} />}
      </div>
    </div>
  );
}
