import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { PageHeader, Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input, Select } from '../../components/ui/Input';
import { ErrorState } from '../../components/ui/ErrorState';
import { PageSkeleton } from '../../components/ui/Skeleton';

interface ListingView {
  id: number;
  duplicataId: string;
  sacado: string;
  cedente: string;
  score: number | null;
  vencimento: string;
  diasRestantes: number;
  valor: number;
  valorOriginalFmt: string;
  precoFmt: string;
  variacaoPct: number;
  melhorLanceFmt: string | null;
}
interface PositionView {
  purchaseId: number;
  duplicataId: string;
  sacado: string;
  valorPagoFmt: string;
  vencimento: string;
  diasRestantes: number;
}
interface BidOnMyListingView {
  id: number;
  bidderCompanyName: string;
  valorFmt: string;
}
interface MyListingView {
  id: number;
  duplicataId: string;
  precoFmt: string;
  status: 'ativo' | 'vendido' | 'cancelado';
  lances: BidOnMyListingView[];
}
interface MyBidView {
  id: number;
  listingId: number;
  duplicataId: string;
  valorFmt: string;
  askingValorFmt: string;
  status: 'ativo' | 'aceito' | 'recusado' | 'cancelado' | 'superado';
  listingStatus: string;
}
interface BlockTradeItemView {
  duplicataId: string;
  valorFmt: string;
}
interface MyBlockTradeView {
  id: number;
  quantidade: number;
  valorTotalFmt: string;
  descontoPct: number;
  createdAt: string;
  itens: BlockTradeItemView[];
}
interface SecundarioData {
  market: ListingView[];
  minhasPosicoes: PositionView[];
  meusAnuncios: MyListingView[];
  meusLances: MyBidView[];
  meusBlockTrades: MyBlockTradeView[];
}

const BID_STATUS_LABEL: Record<MyBidView['status'], string> = {
  ativo: 'Ativo',
  aceito: 'Aceito',
  recusado: 'Recusado',
  cancelado: 'Cancelado',
  superado: 'Substituído',
};

export function SecundarioPage() {
  const [data, setData] = useState<SecundarioData | null>(null);
  const [prices, setPrices] = useState<Record<number, string>>({});
  const [bidValues, setBidValues] = useState<Record<number, string>>({});
  const [error, setError] = useState('');
  const [marketQuery, setMarketQuery] = useState('');
  const [marketSort, setMarketSort] = useState<'variacao' | 'valor' | 'prazo' | 'score'>('variacao');
  // One key at a time, e.g. "buy:42" or "acceptBid:7" — disables just the button that
  // triggered the request (not every button on the page) and blocks a double-click from
  // firing the same money-moving action twice while the first request is still in flight.
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const [blockValorMaximo, setBlockValorMaximo] = useState('');
  const [blockScoreMin, setBlockScoreMin] = useState('');
  const [blockQuantidadeMax, setBlockQuantidadeMax] = useState('');
  const [blockResult, setBlockResult] = useState<{ quantidade: number; valorTotalFmt: string; descontoPct: number } | null>(null);
  const [blockSubmitting, setBlockSubmitting] = useState(false);

  const [loadError, setLoadError] = useState<string | null>(null);

  const load = () => {
    setLoadError(null);
    return api
      .get<SecundarioData>('/secundario')
      .then(setData)
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : 'Falha ao carregar o mercado secundário.'));
  };

  useEffect(() => {
    load();
  }, []);

  const sortedMarket = useMemo(() => {
    const q = marketQuery.trim().toLowerCase();
    let list = data ? data.market.filter((l) => !q || l.sacado.toLowerCase().includes(q) || l.cedente.toLowerCase().includes(q)) : [];
    list = list.slice();
    if (marketSort === 'variacao') list.sort((a, b) => a.variacaoPct - b.variacaoPct);
    else if (marketSort === 'valor') list.sort((a, b) => b.valor - a.valor);
    else if (marketSort === 'prazo') list.sort((a, b) => a.diasRestantes - b.diasRestantes);
    else if (marketSort === 'score') list.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    return list;
  }, [data, marketQuery, marketSort]);

  if (loadError) return <ErrorState message={loadError} onRetry={load} />;
  if (!data) return <PageSkeleton />;

  const runAction = async (key: string, fn: () => Promise<SecundarioData>, fallbackMessage: string) => {
    if (busyKey) return; // one money-moving action in flight at a time
    setError('');
    setBusyKey(key);
    try {
      const res = await fn();
      setData(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : fallbackMessage);
    } finally {
      setBusyKey(null);
    }
  };

  const listPosition = (purchaseId: number) =>
    runAction(
      `listar:${purchaseId}`,
      () => api.post<SecundarioData>('/secundario/listar', { purchaseId, askingValor: prices[purchaseId] ?? '' }),
      'Não foi possível criar o anúncio.'
    );

  const cancel = (id: number) => runAction(`cancelar:${id}`, () => api.post<SecundarioData>(`/secundario/${id}/cancelar`), 'Não foi possível cancelar o anúncio.');

  const buy = (id: number) => runAction(`comprar:${id}`, () => api.post<SecundarioData>(`/secundario/${id}/comprar`), 'Não foi possível comprar esta posição.');

  const placeBid = (listingId: number) =>
    runAction(
      `lance:${listingId}`,
      () => api.post<SecundarioData>(`/secundario/${listingId}/lances`, { valor: bidValues[listingId] ?? '' }),
      'Não foi possível registrar seu lance.'
    );

  const cancelBid = (bidId: number) =>
    runAction(`cancelarLance:${bidId}`, () => api.post<SecundarioData>(`/secundario/lances/${bidId}/cancelar`), 'Não foi possível cancelar o lance.');

  const acceptBid = (bidId: number) =>
    runAction(`aceitarLance:${bidId}`, () => api.post<SecundarioData>(`/secundario/lances/${bidId}/aceitar`), 'Não foi possível aceitar o lance.');

  const rejectBid = (bidId: number) =>
    runAction(`recusarLance:${bidId}`, () => api.post<SecundarioData>(`/secundario/lances/${bidId}/recusar`), 'Não foi possível recusar o lance.');

  const runBlockTrade = async () => {
    setError('');
    setBlockResult(null);
    setBlockSubmitting(true);
    try {
      const res = await api.post<SecundarioData & { blockTradeId: number; quantidade: number; valorTotalFmt: string; descontoPct: number }>(
        '/secundario/block-trade',
        {
          valorMaximo: blockValorMaximo,
          scoreMin: blockScoreMin.trim() ? Number(blockScoreMin) : undefined,
          quantidadeMax: blockQuantidadeMax.trim() ? Number(blockQuantidadeMax) : undefined,
        }
      );
      setData(res);
      setBlockResult({ quantidade: res.quantidade, valorTotalFmt: res.valorTotalFmt, descontoPct: res.descontoPct });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível executar o block trade.');
    } finally {
      setBlockSubmitting(false);
    }
  };

  return (
    <div>
      <PageHeader title="Mercado Secundário" subtitle="Revenda posições antes do vencimento, dê lances, ou compre posições de outros investidores" />

      {error && <div className="mb-4 p-3.5 rounded-lg bg-redBg text-red text-[13px] font-semibold">{error}</div>}

      <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Card>
          <div className="font-bold text-[15px] mb-3.5">Suas posições disponíveis para revenda</div>
          <div className="flex flex-col gap-2.5">
            {data.minhasPosicoes.map((p) => (
              <div key={p.purchaseId} className="bg-surface border border-border rounded-lg px-3.5 py-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-semibold text-[13.5px]">{p.sacado}</div>
                  <div className="text-textTertiary text-[11.5px]">{p.diasRestantes}d até vencer</div>
                </div>
                <div className="text-textSecondary text-[12px] mb-2.5">Pago: {p.valorPagoFmt} · vence {p.vencimento}</div>
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="Preço de venda"
                    value={prices[p.purchaseId] ?? ''}
                    onChange={(e) => setPrices((v) => ({ ...v, [p.purchaseId]: e.target.value }))}
                    className="flex-1"
                  />
                  <Button size="sm" variant="secondary" disabled={busyKey === `listar:${p.purchaseId}`} onClick={() => listPosition(p.purchaseId)}>
                    {busyKey === `listar:${p.purchaseId}` ? 'Anunciando…' : 'Anunciar'}
                  </Button>
                </div>
              </div>
            ))}
            {data.minhasPosicoes.length === 0 && <div className="text-textSecondary text-[12.5px]">Nenhuma posição disponível para revenda no momento.</div>}
          </div>

          {data.meusAnuncios.length > 0 && (
            <>
              <div className="h-px bg-hairline my-4" />
              <div className="font-bold text-[13.5px] mb-2.5">Seus anúncios</div>
              <div className="flex flex-col gap-2.5">
                {data.meusAnuncios.map((a) => (
                  <div key={a.id} className="text-[12.5px]">
                    <div className="flex items-center justify-between">
                      <span className="font-mono-num">{a.duplicataId}</span>
                      <span className="font-semibold">{a.precoFmt}</span>
                      <span className="text-textTertiary">{a.status}</span>
                      {a.status === 'ativo' && (
                        <button
                          type="button"
                          onClick={() => cancel(a.id)}
                          disabled={busyKey === `cancelar:${a.id}`}
                          className="text-red font-bold bg-transparent border-none cursor-pointer disabled:opacity-60 disabled:cursor-default"
                        >
                          {busyKey === `cancelar:${a.id}` ? 'Cancelando…' : 'Cancelar'}
                        </button>
                      )}
                    </div>
                    {a.lances.length > 0 && (
                      <div className="mt-1.5 ml-2 flex flex-col gap-1.5">
                        {a.lances.map((b) => (
                          <div key={b.id} className="flex items-center justify-between bg-surface rounded-md px-2.5 py-1.5">
                            <span className="text-textSecondary">
                              Lance de <b>{b.bidderCompanyName}</b>: {b.valorFmt}
                            </span>
                            <div className="flex gap-1.5">
                              <button
                                type="button"
                                onClick={() => acceptBid(b.id)}
                                disabled={busyKey === `aceitarLance:${b.id}` || busyKey === `recusarLance:${b.id}`}
                                className="text-green font-bold bg-transparent border-none cursor-pointer disabled:opacity-60 disabled:cursor-default"
                              >
                                {busyKey === `aceitarLance:${b.id}` ? 'Aceitando…' : 'Aceitar'}
                              </button>
                              <button
                                type="button"
                                onClick={() => rejectBid(b.id)}
                                disabled={busyKey === `aceitarLance:${b.id}` || busyKey === `recusarLance:${b.id}`}
                                className="text-red font-bold bg-transparent border-none cursor-pointer disabled:opacity-60 disabled:cursor-default"
                              >
                                {busyKey === `recusarLance:${b.id}` ? 'Recusando…' : 'Recusar'}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {data.meusLances.length > 0 && (
            <>
              <div className="h-px bg-hairline my-4" />
              <div className="font-bold text-[13.5px] mb-2.5">Seus lances</div>
              <div className="flex flex-col gap-1.5">
                {data.meusLances.map((b) => (
                  <div key={b.id} className="flex items-center justify-between text-[12.5px]">
                    <span className="font-mono-num">{b.duplicataId}</span>
                    <span className="font-semibold">{b.valorFmt}</span>
                    <span className="text-textTertiary">{BID_STATUS_LABEL[b.status]}</span>
                    {b.status === 'ativo' && (
                      <button
                        type="button"
                        onClick={() => cancelBid(b.id)}
                        disabled={busyKey === `cancelarLance:${b.id}`}
                        className="text-red font-bold bg-transparent border-none cursor-pointer disabled:opacity-60 disabled:cursor-default"
                      >
                        {busyKey === `cancelarLance:${b.id}` ? 'Cancelando…' : 'Cancelar'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>

        <Card>
          <div className="font-bold text-[15px] mb-3.5">Anúncios de outros investidores</div>
          <div className="flex gap-2 mb-3">
            <Input placeholder="Buscar por sacado ou cedente" value={marketQuery} onChange={(e) => setMarketQuery(e.target.value)} className="flex-1" />
            <Select value={marketSort} onChange={(e) => setMarketSort(e.target.value as typeof marketSort)}>
              <option value="variacao">Ordenar: melhor deságio</option>
              <option value="valor">Ordenar: maior valor</option>
              <option value="prazo">Ordenar: vencendo antes</option>
              <option value="score">Ordenar: maior score</option>
            </Select>
          </div>
          <div className="flex flex-col gap-2.5">
            {sortedMarket.map((l) => (
              <div key={l.id} className="bg-surface border border-border rounded-lg px-3.5 py-3">
                <div className="flex items-center justify-between mb-1">
                  <div className="font-semibold text-[13.5px]">{l.sacado}</div>
                  <div className="text-textTertiary text-[11.5px]">{l.diasRestantes}d até vencer</div>
                </div>
                <div className="text-textSecondary text-[12px] mb-1">
                  Preço original {l.valorOriginalFmt} → agora {l.precoFmt} ({l.variacaoPct > 0 ? '+' : ''}
                  {l.variacaoPct}%)
                </div>
                {l.melhorLanceFmt && <div className="text-textSecondary text-[11.5px] mb-2">Melhor lance no mercado: {l.melhorLanceFmt}</div>}
                <div className="flex items-center gap-2">
                  <Button size="sm" disabled={busyKey === `comprar:${l.id}`} onClick={() => buy(l.id)}>
                    {busyKey === `comprar:${l.id}` ? 'Comprando…' : `Comprar por ${l.precoFmt}`}
                  </Button>
                  <Input
                    placeholder="Seu lance"
                    value={bidValues[l.id] ?? ''}
                    onChange={(e) => setBidValues((v) => ({ ...v, [l.id]: e.target.value }))}
                    className="flex-1"
                  />
                  <Button size="sm" variant="secondary" disabled={busyKey === `lance:${l.id}`} onClick={() => placeBid(l.id)}>
                    {busyKey === `lance:${l.id}` ? 'Enviando…' : 'Dar lance'}
                  </Button>
                </div>
              </div>
            ))}
            {sortedMarket.length === 0 && (
              <div className="text-textSecondary text-[12.5px]">
                {data.market.length === 0 ? 'Nenhum anúncio ativo no mercado secundário agora.' : 'Nenhum anúncio corresponde à busca.'}
              </div>
            )}
          </div>
        </Card>
      </div>

      <Card>
        <div className="font-bold text-[15px] mb-1">Block trade institucional</div>
        <div className="text-textSecondary text-[12.5px] mb-3.5">
          Varre vários anúncios ativos de uma vez, ao preço exato anunciado por cada vendedor, com desconto na taxa de plataforma para operações
          de grande volume. Disponível para contas com patrimônio líquido declarado no KYB acima do limite institucional.
        </div>
        <div className="flex items-end gap-2.5 flex-wrap mb-3">
          <div className="flex-1 min-w-[160px]">
            <div className="text-[11.5px] font-bold text-textSecondary mb-1">Orçamento máximo</div>
            <Input placeholder="Ex: 1.000.000" value={blockValorMaximo} onChange={(e) => setBlockValorMaximo(e.target.value)} />
          </div>
          <div className="w-[130px]">
            <div className="text-[11.5px] font-bold text-textSecondary mb-1">Score mínimo</div>
            <Input placeholder="Opcional" value={blockScoreMin} onChange={(e) => setBlockScoreMin(e.target.value)} inputMode="numeric" />
          </div>
          <div className="w-[150px]">
            <div className="text-[11.5px] font-bold text-textSecondary mb-1">Máx. de anúncios</div>
            <Input placeholder="Opcional" value={blockQuantidadeMax} onChange={(e) => setBlockQuantidadeMax(e.target.value)} inputMode="numeric" />
          </div>
          <Button onClick={runBlockTrade} disabled={blockSubmitting || !blockValorMaximo.trim()}>
            {blockSubmitting ? 'Executando…' : 'Executar block trade'}
          </Button>
        </div>

        {blockResult && (
          <div className="mb-3.5 p-3 rounded-lg bg-greenBg text-[13px] font-semibold text-green">
            {blockResult.quantidade} anúncios comprados, total {blockResult.valorTotalFmt} — {blockResult.descontoPct}% de desconto institucional na
            taxa de plataforma.
          </div>
        )}

        {data.meusBlockTrades.length > 0 && (
          <>
            <div className="h-px bg-hairline my-3.5" />
            <div className="font-bold text-[13.5px] mb-2.5">Histórico de block trades</div>
            <div className="flex flex-col gap-2">
              {data.meusBlockTrades.map((bt) => (
                <div key={bt.id} className="bg-surface border border-border rounded-lg px-3.5 py-2.5 text-[12.5px]">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold">
                      {bt.quantidade} duplicatas — {bt.valorTotalFmt}
                    </span>
                    <span className="text-textTertiary">{bt.descontoPct}% desconto</span>
                  </div>
                  <div className="text-textTertiary">{bt.itens.map((i) => i.duplicataId).join(', ')}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
