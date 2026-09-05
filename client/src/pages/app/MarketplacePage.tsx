import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { useApi } from '../../lib/useApi';
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
  id: number;
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
  isMine: boolean;
}
interface LanceDoInvestidor {
  id: number;
  duplicataId: string;
  sacado: string;
  valorFmt: string;
  taxaFmt: string;
  precoFmt: string;
  status: 'ativo' | 'vencedor' | 'perdedor' | 'cancelado';
  closeAt: string | null;
}
interface MeuLance {
  id: number;
  taxaAm: number;
  taxaFmt: string;
  precoFmt: string;
  liderando: boolean;
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
// O prazo do leilão decide de verdade quem leva a duplicata, então ele anda na tela: o
// servidor manda o instante do fechamento (closeAtIso) e quem conta é o cliente. Antes o
// "encerra em" vinha como string pronta do servidor e ficava parada até o próximo frame do
// WebSocket, num leilão que não existia.
function formatarPrazo(closeAtIso: string | null, agora: number): string {
  if (!closeAtIso) return '—';
  const restante = new Date(closeAtIso).getTime() - agora;
  if (restante <= 0) return 'prazo encerrado';
  const seg = Math.floor(restante / 1000);
  const h = Math.floor(seg / 3600);
  const min = Math.floor((seg % 3600) / 60);
  const s = seg % 60;
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${String(min).padStart(2, '0')}min`;
  return `${min}min ${String(s).padStart(2, '0')}s`;
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
  leilaoAberto: boolean;
  leilaoMotivo: string | null;
  closeAtIso: string | null;
  reservaTaxaAm: number;
  reservaTaxaFmt: string;
  reservaPrecoFmt: string;
  melhorTaxaFmt: string | null;
  meuLance: MeuLance | null;
  bidCount: number;
  bids: Bid[];
  countdownSec: number;
  aceiteBadgeLabel: string;
  aceiteBadgeBg: string;
  aceiteBadgeColor: string;
  insurerInfo: Insurer | null;
  insurerOptions: Insurer[];
  aiMatch: boolean;
  aiMatchPct: string;
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
  const [bidTaxa, setBidTaxa] = useState<Record<string, string>>({});
  const [bidError, setBidError] = useState<Record<string, string>>({});
  const [explainFor, setExplainFor] = useState<string | null>(null);
  const [explanation, setExplanation] = useState<FundingExplanation | null>(null);
  const [explainLoading, setExplainLoading] = useState(false);

  // "Meus lances" precisa existir porque o lance deixou de resolver na hora: entre propor e
  // saber o resultado passa o prazo do leilão, e sem essa lista o investidor não teria onde
  // ver o que ainda está de pé, o que venceu e o que perdeu.
  const meusLances = useApi<{ lances: LanceDoInvestidor[] }>('/market/meus-lances');
  const [verMeusLances, setVerMeusLances] = useState(false);
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

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

  // Comprar deixou de existir: o investidor propõe uma TAXA de deságio e o vencedor sai no
  // fechamento do leilão, no close_at. Menor deságio ganha; a taxa de reserva do cedente é
  // o teto — lance pior que ela o servidor recusa com 409 above_reserve.
  const abrirLance = (offer: Offer) => {
    setExpanded((prev) => new Set(prev).add(offer.id));
    setBidError((prev) => ({ ...prev, [offer.id]: '' }));
    setBidTaxa((prev) => ({
      ...prev,
      [offer.id]: prev[offer.id] ?? (offer.meuLance ? offer.meuLance.taxaAm : offer.reservaTaxaAm).toFixed(2).replace('.', ','),
    }));
  };

  const darLance = async (id: string) => {
    setBusyId(id);
    setBidError((prev) => ({ ...prev, [id]: '' }));
    try {
      await api.post(`/market/${id}/lance`, { taxaAm: bidTaxa[id] ?? '' });
      void meusLances.reload();
    } catch (err) {
      setBidError((prev) => ({ ...prev, [id]: err instanceof ApiError ? err.message : 'Não foi possível registrar o lance.' }));
    } finally {
      setBusyId(null);
    }
  };

  const cancelarLance = async (offerId: string, bidId: number) => {
    setBusyId(offerId);
    try {
      await api.post(`/market/lances/${bidId}/cancelar`, {});
      void meusLances.reload();
    } catch (err) {
      setBidError((prev) => ({ ...prev, [offerId]: err instanceof ApiError ? err.message : 'Não foi possível cancelar o lance.' }));
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

      {(meusLances.data?.lances.length ?? 0) > 0 && (
        <div className="bg-white border border-border rounded-card mb-2.5 overflow-hidden">
          <button
            type="button"
            onClick={() => setVerMeusLances((v) => !v)}
            aria-expanded={verMeusLances}
            className="w-full flex items-center justify-between gap-3 px-5 py-3 bg-transparent border-none cursor-pointer text-left"
          >
            <span className="text-[12.5px] font-bold text-navy">
              Meus lances ({meusLances.data!.lances.filter((l) => l.status === 'ativo').length} ativo(s) de {meusLances.data!.lances.length})
            </span>
            <span className="text-[11.5px] font-bold text-textSecondary">{verMeusLances ? 'Ocultar' : 'Ver'}</span>
          </button>
          {verMeusLances && (
            <div className="border-t border-border">
              {meusLances.data!.lances.map((l) => (
                <div key={l.id} className="flex items-center gap-3 px-5 py-2.5 border-b border-hairline last:border-b-0 text-[12.5px] flex-wrap">
                  <span className="font-semibold flex-1 min-w-[160px]">{l.sacado}</span>
                  <span className="text-textSecondary font-mono-num">{l.valorFmt}</span>
                  <span className="font-mono-num font-bold">{l.taxaFmt} a.m.</span>
                  <span className="text-textSecondary font-mono-num">{l.precoFmt}</span>
                  <Badge
                    variant={l.status === 'vencedor' ? 'success' : l.status === 'perdedor' ? 'danger' : l.status === 'cancelado' ? 'neutral' : 'info'}
                    size="sm"
                  >
                    {l.status === 'ativo' ? `aguardando o prazo (${formatarPrazo(l.closeAt, agora)})` : l.status}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex gap-2.5 mb-2.5 flex-wrap">
        <Input aria-label="Buscar por sacado ou cedente" placeholder={t('marketplace.searchPlaceholder', 'Buscar por sacado ou cedente')} value={query} onChange={(e) => setQuery(e.target.value)} className="max-w-[340px]" />
        <Select aria-label="Ordenar ofertas" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="taxa">{t('marketplace.sortRate', 'Ordenar: melhor deságio')}</option>
          <option value="score">{t('marketplace.sortScore', 'Ordenar: maior score')}</option>
          <option value="valor">{t('marketplace.sortValue', 'Ordenar: maior valor')}</option>
          <option value="prazo">{t('marketplace.sortDeadline', 'Ordenar: leilão fechando')}</option>
        </Select>
      </div>

      <div className="flex gap-2.5 mb-4 flex-wrap items-center">
        <Select aria-label="Filtrar por setor" value={setorFilter} onChange={(e) => setSetorFilter(e.target.value)}>
          <option value="">{t('marketplace.filterSector', 'Setor: todos')}</option>
          {SETOR_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
        <Select aria-label="Filtrar por rating" value={ratingFilter} onChange={(e) => setRatingFilter(e.target.value)}>
          <option value="">{t('marketplace.filterRating', 'Rating: todos')}</option>
          {RATING_OPTIONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </Select>
        <div className="flex items-center gap-1.5">
          <Input aria-label="Valor mínimo" type="number" placeholder={t('marketplace.valueMin', 'Valor mín.')} value={valorMin} onChange={(e) => setValorMin(e.target.value)} className="w-[120px]" />
          <span className="text-textTertiary text-xs">–</span>
          <Input aria-label="Valor máximo" type="number" placeholder={t('marketplace.valueMax', 'Valor máx.')} value={valorMax} onChange={(e) => setValorMax(e.target.value)} className="w-[120px]" />
        </div>
        <div className="flex items-center gap-1.5">
          <Input aria-label="Prazo mínimo em dias" type="number" placeholder={t('marketplace.prazoMin', 'Prazo mín. (dias)')} value={prazoMin} onChange={(e) => setPrazoMin(e.target.value)} className="w-[140px]" />
          <span className="text-textTertiary text-xs">–</span>
          <Input aria-label="Prazo máximo em dias" type="number" placeholder={t('marketplace.prazoMax', 'Prazo máx. (dias)')} value={prazoMax} onChange={(e) => setPrazoMax(e.target.value)} className="w-[140px]" />
        </div>
        {hasActiveFilters && (
          <Button size="sm" variant="secondary" onClick={clearFilters}>
            {t('marketplace.clearFilters', 'Limpar filtros')}
          </Button>
        )}
      </div>

      <div role="table" aria-label="Ofertas do marketplace" className="bg-white border border-border rounded-card overflow-hidden">
        <div role="rowgroup"><div role="row"
          className="grid gap-3 px-5 py-3.5 bg-surface border-b border-border text-xs font-bold text-textSecondary uppercase tracking-wide"
          style={{ gridTemplateColumns: '1.3fr 0.9fr 0.8fr 0.7fr 0.8fr 1.6fr' }}
        >
          <div role="columnheader">{t('marketplace.colSacado', 'Sacado')}</div>
          <div role="columnheader">{t('marketplace.colCedente', 'Cedente')}</div>
          <div role="columnheader">{t('marketplace.colValor', 'Valor')}</div>
          <div role="columnheader">{t('marketplace.colDesagio', 'Deságio')}</div>
          <div role="columnheader">{t('marketplace.colVencimento', 'Vencimento')}</div>
          <div role="columnheader">{t('marketplace.colAction', 'Score / Aceite / Ação')}</div>
        </div></div>

        {offers.map((offer) => {
          const isExpanded = expanded.has(offer.id);
          return (
            <div key={offer.id} className="border-b border-border last:border-b-0">
              <div role="row" className="grid gap-3 px-5 py-4 items-center text-sm" style={{ gridTemplateColumns: '1.3fr 0.9fr 0.8fr 0.7fr 0.8fr 1.6fr' }}>
                <div role="cell">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-semibold">{offer.sacado}</span>
                    {offer.setor && offer.setorLabel && (
                      <Badge label={offer.setorLabel} bg={SETOR_STYLE[offer.setor]?.bg ?? PALETTE.hairline} color={SETOR_STYLE[offer.setor]?.color ?? PALETTE.textSecondary} className="text-[10.5px] px-2 py-0.5" />
                    )}
                  </div>
                  {offer.aiMatch && <div className="text-[10.5px] font-bold text-blue mt-0.5">✦ Match de IA — {offer.aiMatchPct} aderente ao seu perfil</div>}
                </div>
                <div role="cell" className="text-textSecondary">{offer.cedente}</div>
                <div role="cell">
                  <div className="font-bold font-mono-num">{offer.valorFmt}</div>
                  <div
                    className="text-[11.5px] text-textTertiary font-mono-num"
                    title="Preço de reserva: o menor preço que o cedente aceita, equivalente ao maior deságio. Um lance com deságio menor paga mais que isso — e é o que ganha o leilão."
                  >
                    Reserva {offer.reservaPrecoFmt}
                  </div>
                </div>
                <div role="cell" className="text-green font-bold">{offer.desagio}</div>
                <div role="cell" className="text-textSecondary">{offer.vencimento}</div>
                <div role="cell" className="flex items-center gap-2 flex-wrap">
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
                  <Button size="sm" disabled={!offer.canBuy || busyId === offer.id} onClick={() => abrirLance(offer)}>
                    {offer.btnLabel}
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
                              <Badge variant="success" size="sm">{t('marketplace.bestQuote', 'Melhor cotação')}</Badge>
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
                            <Input aria-label="Quantidade de tokens a comprar"
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
                        <Input aria-label="Quantidade de tokens" placeholder={t('marketplace.tokenQtyPlaceholder', 'quantidade de tokens')} value={fractionalTokensInput} onChange={(e) => setFractionalTokensInput(e.target.value)} className="flex-1" />
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
                  <div className="flex items-center justify-between pt-2.5 mb-2.5 gap-3 flex-wrap">
                    <div className="text-[11.5px] font-bold text-textSecondary uppercase tracking-wide">
                      {offer.bidCount === 0 ? 'Leilão aberto — nenhum lance ainda' : `Leilão aberto — ${offer.bidCount} ${offer.bidCount === 1 ? 'lance' : 'lances'}`}
                    </div>
                    <div className="text-[11.5px] font-bold font-mono-num" style={{ color: offer.leilaoAberto ? PALETTE.red : PALETTE.textTertiary }}>
                      {offer.leilaoAberto ? `encerra em ${formatarPrazo(offer.closeAtIso, agora)}` : offer.isBought ? 'arrematada' : 'encerrado'}
                    </div>
                  </div>

                  <div className="text-xs text-navy bg-chip rounded-lg px-3 py-2 mb-2.5">
                    Reserva do cedente: <b>{offer.reservaTaxaFmt}</b> a.m. ({offer.reservaPrecoFmt}). Vence o menor deságio proposto até o prazo — lance acima
                    da reserva é recusado, e sem nenhum lance a duplicata não é vendida.
                  </div>

                  {offer.leilaoAberto && (
                    <div className="flex items-end gap-2 flex-wrap mb-2.5">
                      {/* A largura vai no wrapper: Input já traz `w-full`, e uma classe de
                          largura no próprio elemento perde pro utilitário do componente. */}
                      <div className="w-[150px]">
                        <Input
                          aria-label="Taxa de deságio mensal do seu lance, em %"
                          value={bidTaxa[offer.id] ?? ''}
                          onChange={(e) => setBidTaxa((prev) => ({ ...prev, [offer.id]: e.target.value }))}
                          placeholder={`até ${offer.reservaTaxaFmt}`}
                        />
                      </div>
                      <span className="text-[12.5px] text-textSecondary pb-3">% a.m.</span>
                      <Button size="sm" disabled={busyId === offer.id} onClick={() => darLance(offer.id)}>
                        {busyId === offer.id ? 'Enviando…' : offer.meuLance ? 'Atualizar lance' : 'Enviar lance'}
                      </Button>
                      {offer.meuLance && (
                        <button
                          type="button"
                          className="bg-transparent border-none text-textTertiary text-[11.5px] font-bold cursor-pointer underline pb-2"
                          onClick={() => cancelarLance(offer.id, offer.meuLance!.id)}
                        >
                          Cancelar meu lance
                        </button>
                      )}
                    </div>
                  )}
                  {bidError[offer.id] && <div className="text-red text-[12.5px] font-semibold mb-2.5">{bidError[offer.id]}</div>}

                  <div className="flex flex-col gap-2">
                    {offer.bids.map((bid) => (
                      <div key={bid.id} className="flex items-center gap-3.5 bg-white rounded-lg px-3.5 py-2.5" style={{ border: `1px solid ${bid.borderColor}` }}>
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
                    {offer.bids.length === 0 && (
                      <div className="text-[12.5px] text-textSecondary bg-white border border-border rounded-lg px-3.5 py-2.5">
                        Nenhum investidor lançou nesta duplicata ainda.
                      </div>
                    )}
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
