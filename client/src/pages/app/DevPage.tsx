import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { PageSkeleton } from '../../components/ui/Skeleton';
import { PageHeader, Card } from '../../components/ui/Card';
import { Select } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { ErrorState } from '../../components/ui/ErrorState';
import { useSession } from '../../state/SessionContext';
import { PALETTE } from '../../lib/palette';
import { Badge } from '../../components/ui/Badge';
import { useApi } from '../../lib/useApi';

type ApiKeyProduct =
  | 'platform'
  | 'score_api'
  | 'pld_screening_api'
  | 'registro_api'
  | 'judicial_records_api'
  | 'fraud_screening_api'
  | 'document_intelligence_api'
  | 'reconciliation_api'
  | 'suitability_api'
  | 'market_index_api';

const NARROW_PRODUCT_LABELS: Record<Exclude<ApiKeyProduct, 'platform'>, string> = {
  score_api: 'Score API',
  pld_screening_api: 'PLD Screening API',
  registro_api: 'Registro API',
  judicial_records_api: 'Judicial Records API',
  fraud_screening_api: 'Fraud Screening API',
  document_intelligence_api: 'Document Intelligence API',
  reconciliation_api: 'Reconciliation API',
  suitability_api: 'Suitability API',
  market_index_api: 'Lastro Index',
};

interface ApiKeyView {
  id: number;
  prefix: string;
  label: string;
  mode: 'live' | 'test';
  scope: 'read_only' | 'read_write';
  product: ApiKeyProduct;
  callsThisMonth: number;
  createdAt: string;
  lastUsed: string;
}
interface AddonChargeView {
  id: number;
  kind: string;
  quantidade: number;
  valorFmt: string;
  descricao: string;
  quando: string;
}
interface WebhookView {
  id: number;
  url: string;
  event: string;
  active: boolean;
}
interface DeliveryView {
  id: number;
  status: 'pending' | 'success' | 'failed';
  attempt: number;
  responseStatus: number | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}
interface DevData {
  webhookEvents: string[];
  apiKeys: ApiKeyView[];
  apiOverage: { includedCallsPerMonth: number; callsThisMonth: number; overageThisMonth: number; pricePerCallFmt: string; estimatedChargeFmt: string };
  scoreApiPriceFmt: string;
  pldScreeningApiPriceFmt: string;
  registroApiPriceFmt: string;
  judicialRecordsApiPriceFmt: string;
  fraudScreeningApiPriceFmt: string;
  documentIntelligenceApiPriceFmt: string;
  reconciliationApiPriceFmt: string;
  suitabilityApiPriceFmt: string;
  marketIndexApiPriceFmt: string;
  addonCharges: AddonChargeView[];
  webhooks: WebhookView[];
  apiLog: { status: string; method: string; path: string; time: string }[];
  playgroundEndpoint: string;
  playgroundEndpoints: { key: string; label: string }[];
  playgroundMethodPath: string;
  playgroundFields: { key: string; label: string; value: string }[];
  playgroundLoading: boolean;
  playgroundResult: { status: number; latency: number; body: string } | null;
}

export function DevPage() {
  const { user } = useSession();
  // A conta "só-API" (api_partner) nunca alcança o plano Empresarial (não tem aba
  // Assinatura) — a chave de "API completa" existe só pra quem participa do marketplace.
  const isApiPartner = user?.role === 'api_partner';
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState('https://webhook.seusistema.com.br/lastro');
  const [webhookEvent, setWebhookEvent] = useState('duplicata.registrada');
  const [newWebhookSecret, setNewWebhookSecret] = useState<string | null>(null);
  const [keyMode, setKeyMode] = useState<'live' | 'test'>('live');
  const [keyScope, setKeyScope] = useState<'read_write' | 'read_only'>('read_write');
  const [keyProduct, setKeyProduct] = useState<ApiKeyProduct>(isApiPartner ? 'score_api' : 'platform');
  const [openDeliveriesFor, setOpenDeliveriesFor] = useState<number | null>(null);
  const [deliveries, setDeliveries] = useState<DeliveryView[]>([]);
  const [keyError, setKeyError] = useState('');
  const [webhookError, setWebhookError] = useState('');


  const { data, error: loadError, reload: load, setData } = useApi<DevData>('/dev', { fallbackMessage: 'Falha ao carregar o Ambiente de Desenvolvedores.' });

  if (loadError) return <ErrorState message={loadError} onRetry={load} />;
  if (!data) return <PageSkeleton />;

  const setEndpoint = (key: string) => api.post<DevData>('/dev/playground/endpoint', { key }).then(setData);
  const setFieldValue = (field: string, value: string) => api.post<DevData>('/dev/playground/field', { field, value }).then(setData);
  const send = () => api.post<DevData>('/dev/playground/send').then(setData);

  const generateKey = async () => {
    setKeyError('');
    try {
      const res = await api.post<DevData & { rawKey: string }>('/dev/keys/generate', { mode: keyMode, scope: keyScope, product: keyProduct });
      setNewKey(res.rawKey);
      setData(res);
    } catch (err) {
      setKeyError(err instanceof ApiError ? err.message : 'Não foi possível gerar a chave.');
    }
  };
  const revokeKey = (id: number) => {
    if (newKey) setNewKey(null);
    api.post<DevData>(`/dev/keys/${id}/revoke`).then(setData);
  };
  const copyKey = () => {
    if (!newKey) return;
    navigator.clipboard?.writeText(newKey).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const addWebhook = async () => {
    setWebhookError('');
    try {
      const res = await api.post<DevData & { secret: string }>('/dev/webhooks', { url: webhookUrl, event: webhookEvent });
      setNewWebhookSecret(res.secret);
      setData(res);
    } catch (err) {
      setWebhookError(err instanceof ApiError ? err.message : 'Não foi possível criar o webhook.');
    }
  };
  const removeWebhook = (id: number) => api.post<DevData>(`/dev/webhooks/${id}/delete`).then(setData);
  const rotateSecret = async (id: number) => {
    setWebhookError('');
    try {
      const res = await api.post<DevData & { secret: string }>(`/dev/webhooks/${id}/rotate-secret`);
      setNewWebhookSecret(res.secret);
      setData(res);
    } catch (err) {
      setWebhookError(err instanceof ApiError ? err.message : 'Não foi possível rotacionar o secret.');
    }
  };
  const toggleDeliveries = async (id: number) => {
    if (openDeliveriesFor === id) {
      setOpenDeliveriesFor(null);
      return;
    }
    const res = await api.get<{ deliveries: DeliveryView[] }>(`/dev/webhooks/${id}/deliveries`);
    setDeliveries(res.deliveries);
    setOpenDeliveriesFor(id);
  };

  return (
    <div>
      <PageHeader title="Desenvolvedores" subtitle="Chaves de API reais, webhooks assinados e requisições — integre a Lastro ao seu produto" />
      <div className="mb-4 -mt-2">
        <a href="/api/v1/openapi.json" target="_blank" rel="noreferrer" className="text-[12.5px] font-bold text-blue">
          Ver especificação OpenAPI da API (/api/v1/openapi.json) →
        </a>
      </div>

      <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: '1.3fr 1fr' }}>
        <Card>
          <div className="font-bold text-[15px] mb-4">Chave de API</div>
          {newKey && (
            <div className="mb-3.5 p-3.5 rounded-lg bg-amberBg text-[12.5px] text-amber">
              Guarde essa chave agora — por segurança, ela não será mostrada de novo.
            </div>
          )}
          <div className="flex flex-col gap-3 mb-4">
            {newKey && (
              <div className="flex items-center gap-2.5 bg-surface border border-border rounded-lg px-3.5 py-2.5 font-mono-num text-[13px]">
                <div className="flex-1 break-all">{newKey}</div>
                <button type="button" onClick={copyKey} className="text-[11.5px] font-bold text-blue cursor-pointer bg-transparent border-none flex-shrink-0">
                  {copied ? 'Copiado!' : 'Copiar'}
                </button>
              </div>
            )}
            {data.apiKeys.map((k) => (
              <div key={k.id} className="flex items-center gap-2.5 bg-surface border border-border rounded-lg px-3.5 py-2.5">
                <div className="flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-mono-num text-[13px]">{k.prefix}••••••••••••••••</span>
                    <span
                      className="text-[10.5px] font-bold px-1.5 py-0.5 rounded"
                      style={k.mode === 'test' ? { background: PALETTE.amberBg, color: PALETTE.amber } : { background: PALETTE.greenBg, color: PALETTE.green }}
                    >
                      {k.mode === 'test' ? 'Sandbox' : 'Produção'}
                    </span>
                    <Badge variant="neutral" size="sm">
                      {k.scope === 'read_only' ? 'Somente leitura' : 'Leitura e escrita'}
                    </Badge>
                    {k.product !== 'platform' && (
                      <span className="text-[10.5px] font-bold px-1.5 py-0.5 rounded" style={{ background: PALETTE.chip, color: PALETTE.blue }}>
                        {NARROW_PRODUCT_LABELS[k.product]}
                      </span>
                    )}
                  </div>
                  <div className="text-textTertiary text-[11.5px] mt-0.5">
                    Criada {k.createdAt} · usada pela última vez: {k.lastUsed} · {k.callsThisMonth} chamada{k.callsThisMonth === 1 ? '' : 's'} este mês
                  </div>
                </div>
                <button type="button" onClick={() => revokeKey(k.id)} className="text-[11.5px] font-bold text-red cursor-pointer bg-transparent border-none flex-shrink-0">
                  Revogar
                </button>
              </div>
            ))}
            {data.apiKeys.length === 0 && !newKey && <div className="text-textSecondary text-[12.5px]">Nenhuma chave ativa ainda.</div>}
          </div>
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <Select aria-label="Modo da chave de API" value={keyMode} onChange={(e) => setKeyMode(e.target.value as 'live' | 'test')} className="text-[12.5px]">
              <option value="live">Produção</option>
              <option value="test">Sandbox (teste)</option>
            </Select>
            <Select aria-label="Escopo da chave de API" value={keyScope} onChange={(e) => setKeyScope(e.target.value as 'read_write' | 'read_only')} className="text-[12.5px]">
              <option value="read_write">Leitura e escrita</option>
              <option value="read_only">Somente leitura</option>
            </Select>
            <Select aria-label="Produto da chave de API" value={keyProduct} onChange={(e) => setKeyProduct(e.target.value as typeof keyProduct)} className="text-[12.5px]">
              {!isApiPartner && <option value="platform">API completa (plataforma)</option>}
              <option value="score_api">Score API — {data.scoreApiPriceFmt}/chamada</option>
              <option value="pld_screening_api">PLD Screening API — {data.pldScreeningApiPriceFmt}/chamada</option>
              <option value="registro_api">Registro API — {data.registroApiPriceFmt}/registro</option>
              <option value="judicial_records_api">Judicial Records API — {data.judicialRecordsApiPriceFmt}/consulta</option>
              <option value="fraud_screening_api">Fraud Screening API — {data.fraudScreeningApiPriceFmt}/avaliação</option>
              <option value="document_intelligence_api">Document Intelligence API — {data.documentIntelligenceApiPriceFmt}/documento</option>
              <option value="reconciliation_api">Reconciliation API — {data.reconciliationApiPriceFmt}/conciliação</option>
              <option value="suitability_api">Suitability API — {data.suitabilityApiPriceFmt}/avaliação</option>
              <option value="market_index_api">Lastro Index — {data.marketIndexApiPriceFmt}/consulta</option>
            </Select>
          </div>
          <Button size="sm" variant="secondary" onClick={generateKey}>
            Gerar {data.apiKeys.length > 0 ? 'nova chave' : 'chave de produção'}
          </Button>
          {keyError && <div className="mt-2 text-[12.5px] font-semibold text-red">{keyError}</div>}
          {keyProduct !== 'platform' && (
            <div className="mt-2 text-[11.5px] text-textTertiary">
              Produto avulso, vendável a empresas que não são clientes Lastro — cobrado por chamada, sem exigir plano Empresarial.
            </div>
          )}

          <div className="h-px bg-hairline my-5" />

          <div className="font-bold text-[15px] mb-3.5">Endpoint de exemplo</div>
          <pre className="bg-navy rounded-[10px] p-4.5 font-mono-num text-[12.5px] leading-loose text-blueSoft overflow-x-auto whitespace-pre">{`POST /api/v1/duplicatas
Authorization: Bearer ${newKey ?? (data.apiKeys[0] ? data.apiKeys[0].prefix + '••••••••••••••••' : 'lastro_live_••••••••••••••••')}

{
  "sacado": "Grupo Atlas Varejo",
  "cnpj": "12.345.678/0001-90",
  "valor": "84.500,00",
  "vencimento": "2026-08-12",
  "seguro": true
}`}</pre>
        </Card>

        <Card>
          <div className="font-bold text-[15px] mb-4">Webhooks</div>
          <div className="flex flex-col gap-2 mb-3.5">
            {data.webhooks.map((w) => (
              <div key={w.id} className="rounded-[10px] bg-surface overflow-hidden">
                <div className="flex items-center justify-between px-3.5 py-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-[13px] font-mono-num">{w.event}</div>
                    <div className="text-textSecondary text-[11.5px] mt-0.5 truncate">{w.url}</div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                    <button type="button" onClick={() => toggleDeliveries(w.id)} className="text-[11.5px] font-bold text-blue cursor-pointer bg-transparent border-none">
                      {openDeliveriesFor === w.id ? 'Ocultar entregas' : 'Ver entregas'}
                    </button>
                    <button type="button" onClick={() => rotateSecret(w.id)} className="text-[11.5px] font-bold text-blue cursor-pointer bg-transparent border-none">
                      Rotacionar secret
                    </button>
                    <button type="button" onClick={() => removeWebhook(w.id)} className="text-[11.5px] font-bold text-red cursor-pointer bg-transparent border-none">
                      Remover
                    </button>
                  </div>
                </div>
                {openDeliveriesFor === w.id && (
                  <div className="px-3.5 pb-3 flex flex-col gap-1.5">
                    {deliveries.length === 0 && <div className="text-textTertiary text-[11.5px]">Nenhuma entrega registrada ainda.</div>}
                    {deliveries.map((d) => (
                      <div key={d.id} className="flex items-center gap-2 text-[11.5px] font-mono-num">
                        <span
                          className="font-bold px-1.5 py-0.5 rounded"
                          style={
                            d.status === 'success'
                              ? { background: PALETTE.greenBg, color: PALETTE.green }
                              : d.status === 'failed'
                                ? { background: PALETTE.redBg, color: PALETTE.red }
                                : { background: PALETTE.amberBg, color: PALETTE.amber }
                          }
                        >
                          {d.status}
                        </span>
                        <span className="text-textSecondary">tentativa {d.attempt}</span>
                        {d.responseStatus !== null && <span className="text-textSecondary">HTTP {d.responseStatus}</span>}
                        <span className="text-textTertiary">{d.updatedAt}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {data.webhooks.length === 0 && <div className="text-textSecondary text-[12.5px]">Nenhum webhook registrado ainda.</div>}
          </div>
          <div className="flex flex-col gap-2 mb-2.5">
            <input aria-label="URL do webhook"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://sua-url.com/webhook"
              className="w-full px-3 py-2 rounded-md border border-inputBorder font-mono-num text-[12.5px] outline-none"
            />
            <Select aria-label="Evento do webhook" value={webhookEvent} onChange={(e) => setWebhookEvent(e.target.value)} className="font-mono-num text-[12.5px]">
              {data.webhookEvents.map((ev) => (
                <option key={ev} value={ev}>
                  {ev}
                </option>
              ))}
            </Select>
          </div>
          <Button size="sm" variant="secondary" onClick={addWebhook}>
            Adicionar webhook
          </Button>
          {webhookError && <div className="mt-2 text-[12.5px] font-semibold text-red">{webhookError}</div>}
          {newWebhookSecret && (
            <div className="mt-3 p-3 rounded-lg bg-amberBg text-[12.5px] text-amber">
              Assinatura para verificar as requisições (guarde agora, não será mostrada de novo):
              <div className="font-mono-num break-all mt-1">{newWebhookSecret}</div>
            </div>
          )}
        </Card>
      </div>

      <Card className="mb-4">
        <div className="font-bold text-[15px] mb-1">Widget embutível</div>
        <div className="text-textSecondary text-[12.5px] mb-3.5">
          Um simulador de antecipação que você pode embutir no seu site — usa o mesmo modelo de taxa da Lastro, sem precisar de chave de API.
        </div>
        <pre className="bg-navy rounded-[10px] p-4.5 font-mono-num text-[12.5px] leading-loose text-blueSoft overflow-x-auto whitespace-pre">{`<iframe
  src="${window.location.origin}/embed/simulador"
  width="100%" height="420" style="border:0;border-radius:12px"
  title="Simulador de antecipação Lastro">
</iframe>`}</pre>
      </Card>

      <Card className="mb-4">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2.5">
          <div>
            <div className="font-bold text-[15px]">Simulador de API</div>
            <div className="text-textSecondary text-[12.5px] mt-0.5">Monte uma requisição e veja a resposta simulada da Lastro em tempo real</div>
          </div>
          <Select aria-label="Endpoint do playground" value={data.playgroundEndpoint} onChange={(e) => setEndpoint(e.target.value)} className="font-semibold">
            {data.playgroundEndpoints.map((ep) => (
              <option key={ep.key} value={ep.key}>
                {ep.label}
              </option>
            ))}
          </Select>
        </div>

        <div className="font-mono-num text-[12.5px] font-bold text-blue mb-3.5">{data.playgroundMethodPath}</div>

        <div className="grid gap-4" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div>
            <div className="flex flex-col gap-3 mb-4">
              {data.playgroundFields.map((f) => (
                <div key={f.key}>
                  <div className="text-xs font-bold text-textSecondary mb-1.5">{f.label}</div>
                  <input aria-label="Valor do parâmetro"
                    value={f.value}
                    onChange={(e) => setFieldValue(f.key, e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-lg border border-inputBorder font-mono-num text-[13px] outline-none"
                  />
                </div>
              ))}
            </div>
            <Button disabled={data.playgroundLoading} onClick={send}>
              {data.playgroundLoading ? 'Enviando…' : 'Enviar requisição'}
            </Button>
          </div>

          <div className="bg-navy rounded-[10px] p-4 min-h-[180px]">
            {data.playgroundLoading && <div className="text-textTertiary font-mono-num text-[12.5px]">Aguardando resposta…</div>}
            {data.playgroundResult && !data.playgroundLoading && (
              <>
                <div className="flex items-center gap-2.5 mb-2.5">
                  <span className="font-mono-num text-xs font-extrabold px-2 py-0.5 rounded-md bg-greenBg text-green">{data.playgroundResult.status} OK</span>
                  <span className="font-mono-num text-[11.5px] text-textTertiary">{data.playgroundResult.latency} ms</span>
                </div>
                <pre className="font-mono-num text-xs leading-loose text-blueSoft whitespace-pre-wrap break-all">{data.playgroundResult.body}</pre>
              </>
            )}
          </div>
        </div>
      </Card>

      <Card className="mb-4">
        <div className="font-bold text-[15px] mb-1">Uso e cobrança de excedente</div>
        <div className="text-textSecondary text-[12.5px] mb-4">
          A franquia mensal é gratuita — chamadas de chaves de produção da API completa além dela são cobradas automaticamente no fechamento do mês.
        </div>
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          <div className="bg-surface rounded-lg p-3.5">
            <div className="text-textTertiary text-[11.5px] font-bold uppercase">Franquia mensal</div>
            <div className="font-mono-num text-[15px] font-extrabold mt-1">{data.apiOverage.includedCallsPerMonth.toLocaleString('pt-BR')}</div>
          </div>
          <div className="bg-surface rounded-lg p-3.5">
            <div className="text-textTertiary text-[11.5px] font-bold uppercase">Chamadas este mês</div>
            <div className="font-mono-num text-[15px] font-extrabold mt-1">{data.apiOverage.callsThisMonth.toLocaleString('pt-BR')}</div>
          </div>
          <div className="bg-surface rounded-lg p-3.5">
            <div className="text-textTertiary text-[11.5px] font-bold uppercase">Excedente</div>
            <div className="font-mono-num text-[15px] font-extrabold mt-1">
              {data.apiOverage.overageThisMonth.toLocaleString('pt-BR')} <span className="text-textTertiary text-[11.5px] font-semibold">({data.apiOverage.pricePerCallFmt}/chamada)</span>
            </div>
          </div>
          <div className="bg-surface rounded-lg p-3.5">
            <div className="text-textTertiary text-[11.5px] font-bold uppercase">Estimativa a cobrar</div>
            <div className="font-mono-num text-[15px] font-extrabold mt-1">{data.apiOverage.estimatedChargeFmt}</div>
          </div>
        </div>
        {data.addonCharges.length > 0 && (
          <>
            <div className="h-px bg-hairline my-4" />
            <div className="font-bold text-[13px] mb-2.5">Cobranças recentes</div>
            <div className="flex flex-col gap-1.5">
              {data.addonCharges.map((c) => (
                <div key={c.id} className="flex items-center justify-between text-[12.5px] gap-2">
                  <span className="text-textSecondary flex-1 min-w-0 truncate">{c.descricao}</span>
                  <span className="font-mono-num font-bold flex-shrink-0">{c.valorFmt}</span>
                  <span className="text-textTertiary flex-shrink-0">{c.quando}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>

      <div className="bg-white border border-border rounded-card overflow-hidden">
        <div className="px-5 py-4.5 font-bold text-[15px] border-b border-border">Requisições recentes</div>
        {data.apiLog.map((r, i) => (
          <div key={i} className="grid gap-3 px-5 py-3.5 border-b border-hairline last:border-b-0 items-center text-[13px]" style={{ gridTemplateColumns: '0.7fr 1fr 1.6fr 0.7fr' }}>
            <span
              className="text-[11.5px] font-bold px-2 py-1 rounded-md w-fit"
              style={r.status.startsWith('2') ? { background: PALETTE.greenBg, color: PALETTE.green } : { background: PALETTE.redBg, color: PALETTE.red }}
            >
              {r.status}
            </span>
            <div className="font-mono-num font-semibold">{r.method}</div>
            <div className="text-textSecondary font-mono-num text-[12.5px]">{r.path}</div>
            <div className="text-textSecondary font-mono-num text-xs">{r.time}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
