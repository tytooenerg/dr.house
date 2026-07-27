import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { PageHeader, Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';

interface ListingView {
  id: number;
  duplicataId: string;
  sacado: string;
  cedente: string;
  score: number | null;
  vencimento: string;
  diasRestantes: number;
  valorOriginalFmt: string;
  precoFmt: string;
  variacaoPct: number;
}
interface PositionView {
  purchaseId: number;
  duplicataId: string;
  sacado: string;
  valorPagoFmt: string;
  vencimento: string;
  diasRestantes: number;
}
interface MyListingView {
  id: number;
  duplicataId: string;
  precoFmt: string;
  status: 'ativo' | 'vendido' | 'cancelado';
}
interface SecundarioData {
  market: ListingView[];
  minhasPosicoes: PositionView[];
  meusAnuncios: MyListingView[];
}

export function SecundarioPage() {
  const [data, setData] = useState<SecundarioData | null>(null);
  const [prices, setPrices] = useState<Record<number, string>>({});
  const [error, setError] = useState('');

  const load = () => api.get<SecundarioData>('/secundario').then(setData);

  useEffect(() => {
    load();
  }, []);

  if (!data) return null;

  const listPosition = async (purchaseId: number) => {
    setError('');
    try {
      const res = await api.post<SecundarioData>('/secundario/listar', { purchaseId, askingValor: prices[purchaseId] ?? '' });
      setData(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível criar o anúncio.');
    }
  };

  const cancel = (id: number) => api.post<SecundarioData>(`/secundario/${id}/cancelar`).then(setData);

  const buy = async (id: number) => {
    setError('');
    try {
      const res = await api.post<SecundarioData>(`/secundario/${id}/comprar`);
      setData(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível comprar esta posição.');
    }
  };

  return (
    <div>
      <PageHeader title="Mercado Secundário" subtitle="Revenda posições antes do vencimento, ou compre posições de outros investidores" />

      {error && <div className="mb-4 p-3.5 rounded-lg bg-redBg text-red text-[13px] font-semibold">{error}</div>}

      <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Card>
          <div className="font-bold text-[15px] mb-3.5">Suas posições disponíveis para revenda</div>
          <div className="flex flex-col gap-2.5">
            {data.minhasPosicoes.map((p) => (
              <div key={p.purchaseId} className="bg-[#F7F8FA] border border-border rounded-lg px-3.5 py-3">
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
                  <Button size="sm" variant="secondary" onClick={() => listPosition(p.purchaseId)}>
                    Anunciar
                  </Button>
                </div>
              </div>
            ))}
            {data.minhasPosicoes.length === 0 && <div className="text-textSecondary text-[12.5px]">Nenhuma posição disponível para revenda no momento.</div>}
          </div>

          {data.meusAnuncios.length > 0 && (
            <>
              <div className="h-px bg-[#EEF1F5] my-4" />
              <div className="font-bold text-[13.5px] mb-2.5">Seus anúncios</div>
              <div className="flex flex-col gap-2">
                {data.meusAnuncios.map((a) => (
                  <div key={a.id} className="flex items-center justify-between text-[12.5px]">
                    <span className="font-mono-num">{a.duplicataId}</span>
                    <span className="font-semibold">{a.precoFmt}</span>
                    <span className="text-textTertiary">{a.status}</span>
                    {a.status === 'ativo' && (
                      <button type="button" onClick={() => cancel(a.id)} className="text-red font-bold bg-transparent border-none cursor-pointer">
                        Cancelar
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
          <div className="flex flex-col gap-2.5">
            {data.market.map((l) => (
              <div key={l.id} className="bg-[#F7F8FA] border border-border rounded-lg px-3.5 py-3">
                <div className="flex items-center justify-between mb-1">
                  <div className="font-semibold text-[13.5px]">{l.sacado}</div>
                  <div className="text-textTertiary text-[11.5px]">{l.diasRestantes}d até vencer</div>
                </div>
                <div className="text-textSecondary text-[12px] mb-2">
                  Preço original {l.valorOriginalFmt} → agora {l.precoFmt} ({l.variacaoPct > 0 ? '+' : ''}
                  {l.variacaoPct}%)
                </div>
                <Button size="sm" onClick={() => buy(l.id)}>
                  Comprar por {l.precoFmt}
                </Button>
              </div>
            ))}
            {data.market.length === 0 && <div className="text-textSecondary text-[12.5px]">Nenhum anúncio ativo no mercado secundário agora.</div>}
          </div>
        </Card>
      </div>
    </div>
  );
}
