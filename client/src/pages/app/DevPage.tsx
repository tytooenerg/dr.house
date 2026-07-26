import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { PageSkeleton } from '../../components/ui/Skeleton';
import { PageHeader, Card } from '../../components/ui/Card';
import { Select } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';

interface ApiKeyView {
  id: number;
  prefix: string;
  label: string;
  createdAt: string;
  lastUsed: string;
}
interface WebhookView {
  id: number;
  url: string;
  event: string;
  active: boolean;
}
interface DevData {
  webhookEvents: string[];
  apiKeys: ApiKeyView[];
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
  const [data, setData] = useState<DevData | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState('https://webhook.seusistema.com.br/lastro');
  const [webhookEvent, setWebhookEvent] = useState('duplicata.registrada');
  const [newWebhookSecret, setNewWebhookSecret] = useState<string | null>(null);

  const load = () => api.get<DevData>('/dev').then(setData);

  useEffect(() => {
    load();
  }, []);

  if (!data) return <PageSkeleton />;

  const setEndpoint = (key: string) => api.post<DevData>('/dev/playground/endpoint', { key }).then(setData);
  const setFieldValue = (field: string, value: string) => api.post<DevData>('/dev/playground/field', { field, value }).then(setData);
  const send = () => api.post<DevData>('/dev/playground/send').then(setData);

  const generateKey = async () => {
    const res = await api.post<DevData & { rawKey: string }>('/dev/keys/generate');
    setNewKey(res.rawKey);
    setData(res);
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
    const res = await api.post<DevData & { secret: string }>('/dev/webhooks', { url: webhookUrl, event: webhookEvent });
    setNewWebhookSecret(res.secret);
    setData(res);
  };
  const removeWebhook = (id: number) => api.post<DevData>(`/dev/webhooks/${id}/delete`).then(setData);

  return (
    <div>
      <PageHeader title="Desenvolvedores" subtitle="Chaves de API reais, webhooks assinados e requisições — integre a Lastro ao seu produto" />

      <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: '1.3fr 1fr' }}>
        <Card>
          <div className="font-bold text-[15px] mb-4">Chave de API</div>
          {newKey && (
            <div className="mb-3.5 p-3.5 rounded-lg bg-amberBg text-[12.5px] text-[#8A5A00]">
              Guarde essa chave agora — por segurança, ela não será mostrada de novo.
            </div>
          )}
          <div className="flex flex-col gap-3 mb-4">
            {newKey && (
              <div className="flex items-center gap-2.5 bg-[#F7F8FA] border border-border rounded-lg px-3.5 py-2.5 font-mono-num text-[13px]">
                <div className="flex-1 break-all">{newKey}</div>
                <button type="button" onClick={copyKey} className="text-[11.5px] font-bold text-blue cursor-pointer bg-transparent border-none flex-shrink-0">
                  {copied ? 'Copiado!' : 'Copiar'}
                </button>
              </div>
            )}
            {data.apiKeys.map((k) => (
              <div key={k.id} className="flex items-center gap-2.5 bg-[#F7F8FA] border border-border rounded-lg px-3.5 py-2.5">
                <div className="flex-1">
                  <div className="font-mono-num text-[13px]">{k.prefix}••••••••••••••••</div>
                  <div className="text-textTertiary text-[11px] mt-0.5">
                    Criada {k.createdAt} · usada pela última vez: {k.lastUsed}
                  </div>
                </div>
                <button type="button" onClick={() => revokeKey(k.id)} className="text-[11.5px] font-bold text-red cursor-pointer bg-transparent border-none flex-shrink-0">
                  Revogar
                </button>
              </div>
            ))}
            {data.apiKeys.length === 0 && !newKey && <div className="text-textSecondary text-[12.5px]">Nenhuma chave ativa ainda.</div>}
          </div>
          <Button size="sm" variant="secondary" onClick={generateKey}>
            Gerar {data.apiKeys.length > 0 ? 'nova chave' : 'chave de produção'}
          </Button>

          <div className="h-px bg-[#EEF1F5] my-5" />

          <div className="font-bold text-[15px] mb-3.5">Endpoint de exemplo</div>
          <pre className="bg-navy rounded-[10px] p-4.5 font-mono-num text-[12.5px] leading-loose text-[#C7D6FF] overflow-x-auto whitespace-pre">{`POST /api/v1/duplicatas
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
              <div key={w.id} className="flex items-center justify-between px-3.5 py-3 rounded-[10px] bg-[#F7F8FA]">
                <div className="min-w-0">
                  <div className="font-semibold text-[13px] font-mono-num">{w.event}</div>
                  <div className="text-textSecondary text-[11.5px] mt-0.5 truncate">{w.url}</div>
                </div>
                <button type="button" onClick={() => removeWebhook(w.id)} className="text-[11.5px] font-bold text-red cursor-pointer bg-transparent border-none flex-shrink-0 ml-2">
                  Remover
                </button>
              </div>
            ))}
            {data.webhooks.length === 0 && <div className="text-textSecondary text-[12.5px]">Nenhum webhook registrado ainda.</div>}
          </div>
          <div className="flex flex-col gap-2 mb-2.5">
            <input
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://sua-url.com/webhook"
              className="w-full px-3 py-2 rounded-md border border-inputBorder font-mono-num text-[12.5px] outline-none"
            />
            <Select value={webhookEvent} onChange={(e) => setWebhookEvent(e.target.value)} className="font-mono-num text-[12.5px]">
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
          {newWebhookSecret && (
            <div className="mt-3 p-3 rounded-lg bg-amberBg text-[12px] text-[#8A5A00]">
              Assinatura para verificar as requisições (guarde agora, não será mostrada de novo):
              <div className="font-mono-num break-all mt-1">{newWebhookSecret}</div>
            </div>
          )}
        </Card>
      </div>

      <Card className="mb-4">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2.5">
          <div>
            <div className="font-bold text-[15px]">Simulador de API</div>
            <div className="text-textSecondary text-[12.5px] mt-0.5">Monte uma requisição e veja a resposta simulada da Lastro em tempo real</div>
          </div>
          <Select value={data.playgroundEndpoint} onChange={(e) => setEndpoint(e.target.value)} className="font-semibold">
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
                  <input
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
                <pre className="font-mono-num text-xs leading-loose text-[#C7D6FF] whitespace-pre-wrap break-all">{data.playgroundResult.body}</pre>
              </>
            )}
          </div>
        </div>
      </Card>

      <div className="bg-white border border-border rounded-card overflow-hidden">
        <div className="px-5 py-4.5 font-bold text-[15px] border-b border-border">Requisições recentes</div>
        {data.apiLog.map((r, i) => (
          <div key={i} className="grid gap-3 px-5 py-3.5 border-b border-hairline last:border-b-0 items-center text-[13px]" style={{ gridTemplateColumns: '0.7fr 1fr 1.6fr 0.7fr' }}>
            <span
              className="text-[11px] font-bold px-2 py-1 rounded-md w-fit"
              style={r.status.startsWith('2') ? { background: '#EAF3EE', color: '#0A5C36' } : { background: '#F7E9E7', color: '#B03A2E' }}
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
