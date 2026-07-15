import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { PageHeader, Card } from '../../components/ui/Card';
import { Select } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { Toggle } from '../../components/ui/Toggle';

interface DevData {
  liveKeyRevealed: boolean;
  webhookEnabled: boolean;
  webhookEvents: string[];
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
  const [copied, setCopied] = useState(false);

  const load = () => api.get<DevData>('/dev').then(setData);

  useEffect(() => {
    load();
  }, []);

  if (!data) return null;

  const toggleReveal = () => api.post<DevData>('/dev/key/reveal').then(setData);
  const toggleWebhook = () => api.post<DevData>('/dev/webhook/toggle').then(setData);
  const setEndpoint = (key: string) => api.post<DevData>('/dev/playground/endpoint', { key }).then(setData);
  const setFieldValue = (field: string, value: string) => api.post<DevData>('/dev/playground/field', { field, value }).then(setData);
  const send = () => api.post<DevData>('/dev/playground/send').then(setData);

  const copyKey = () => {
    navigator.clipboard?.writeText('sk_test_51NkQ8xYzLastro9f2a').catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div>
      <PageHeader title="Desenvolvedores" subtitle="Chaves de API, webhooks e requisições — integre a Lastro ao seu produto" />

      <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: '1.3fr 1fr' }}>
        <Card>
          <div className="font-bold text-[15px] mb-4">Chaves de API</div>
          <div className="flex flex-col gap-3">
            <div>
              <div className="text-xs font-bold text-textSecondary mb-1.5">Chave de teste</div>
              <div className="flex items-center gap-2.5 bg-[#F7F8FA] border border-border rounded-lg px-3.5 py-2.5 font-mono-num text-[13px]">
                <div className="flex-1">sk_test_51NkQ8xYzLastro9f2a</div>
                <button type="button" onClick={copyKey} className="text-[11.5px] font-bold text-blue cursor-pointer bg-transparent border-none">
                  {copied ? 'Copiado!' : 'Copiar'}
                </button>
              </div>
            </div>
            <div>
              <div className="text-xs font-bold text-textSecondary mb-1.5">Chave de produção</div>
              <div className="flex items-center gap-2.5 bg-[#F7F8FA] border border-border rounded-lg px-3.5 py-2.5 font-mono-num text-[13px]">
                <div className="flex-1">{data.liveKeyRevealed ? 'sk_live_51NkQ8xYzLastro7c4d' : '••••••••••••••••••••'}</div>
                <button type="button" onClick={toggleReveal} className="text-[11.5px] font-bold text-blue cursor-pointer bg-transparent border-none">
                  {data.liveKeyRevealed ? 'Ocultar' : 'Revelar'}
                </button>
              </div>
            </div>
          </div>

          <div className="h-px bg-[#EEF1F5] my-5" />

          <div className="font-bold text-[15px] mb-3.5">Endpoint de exemplo</div>
          <pre className="bg-navy rounded-[10px] p-4.5 font-mono-num text-[12.5px] leading-loose text-[#C7D6FF] overflow-x-auto whitespace-pre">{`POST https://api.lastro.com.br/v1/duplicatas
Authorization: Bearer sk_test_51NkQ8xYzLastro9f2a

{
  "sacado_cnpj": "12.345.678/0001-90",
  "valor": 84500.00,
  "vencimento": "2026-08-12",
  "seguro": true
}`}</pre>
        </Card>

        <Card>
          <div className="font-bold text-[15px] mb-4">Webhook</div>
          <div className="flex items-center justify-between px-3.5 py-3 rounded-[10px] bg-[#F7F8FA] mb-3.5">
            <div>
              <div className="font-semibold text-[13px]">duplicata.registrada</div>
              <div className="text-textSecondary text-[11.5px] mt-0.5">webhook.seusistema.com.br/lastro</div>
            </div>
            <Toggle on={data.webhookEnabled} onClick={toggleWebhook} size="sm" />
          </div>
          <div className="text-xs font-bold text-textSecondary mb-2.5">Eventos disponíveis</div>
          <div className="flex flex-col gap-2">
            {data.webhookEvents.map((ev) => (
              <div key={ev} className="flex items-center gap-2 text-[12.5px] font-mono-num" style={{ color: '#3D4658' }}>
                <span className="rounded-full bg-blue" style={{ width: 6, height: 6 }} />
                {ev}
              </div>
            ))}
          </div>
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
