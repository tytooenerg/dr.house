import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { PageSkeleton } from '../../components/ui/Skeleton';
import { PageHeader, Card, NavyCard } from '../../components/ui/Card';
import { Toggle } from '../../components/ui/Toggle';
import { Button } from '../../components/ui/Button';

interface Connector {
  key: string;
  name: string;
  desc: string;
  connected: boolean;
  real: boolean;
  btnLabel: string;
}
interface ErpData {
  connectors: Connector[];
  whitelabelOn: boolean;
  omieConnected: boolean;
}
interface ContaReceber {
  codigoLancamento: number;
  cliente: string;
  numeroDocumento: string;
  valor: number;
  vencimento: string;
}

export function ErpPage() {
  const [data, setData] = useState<ErpData | null>(null);
  const [omieForm, setOmieForm] = useState(false);
  const [appKey, setAppKey] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [omieError, setOmieError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [contas, setContas] = useState<ContaReceber[] | null>(null);

  const load = () => api.get<ErpData>('/erp').then(setData);

  useEffect(() => {
    load();
  }, []);

  if (!data) return <PageSkeleton />;

  const toggleConnector = (key: string) => api.post<ErpData>(`/erp/${key}/toggle`).then(setData);

  const connectOmie = async () => {
    setBusy(true);
    setOmieError(null);
    try {
      const d = await api.post<ErpData>('/erp/omie/connect', { appKey, appSecret });
      setData(d);
      setOmieForm(false);
      setAppKey('');
      setAppSecret('');
    } catch {
      setOmieError('Não foi possível validar as credenciais Omie. Confira o app_key/app_secret em Omie > Configurações > API.');
    } finally {
      setBusy(false);
    }
  };

  const disconnectOmie = () => api.post<ErpData>('/erp/omie/disconnect').then((d) => { setData(d); setContas(null); });

  const buscarContas = async () => {
    setBusy(true);
    try {
      const res = await api.get<{ contas: ContaReceber[] }>('/erp/omie/contas-receber');
      setContas(res.contas);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader title="Integrações ERP" subtitle="Conecte seu sistema de gestão — suas vendas viram duplicatas escriturais automaticamente, sem digitação manual" />

      <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        {data.connectors.map((c) => (
          <Card key={c.key}>
            <div className="w-11 h-11 rounded-[10px] bg-bg flex items-center justify-center font-extrabold text-[15px] text-navy mb-4">{c.name}</div>
            <div className="font-bold text-[15.5px] mb-2">{c.name}</div>
            <div className="text-textSecondary text-[13px] leading-snug mb-4.5 min-h-14">{c.desc}</div>

            {c.key === 'omie' && c.connected ? (
              <div className="flex flex-col gap-2">
                <button type="button" disabled className="w-full py-2.5 rounded-lg border-none text-[13px] font-bold" style={{ background: '#EAF3EE', color: '#0A5C36' }}>
                  Conectado ✓
                </button>
                <button type="button" onClick={buscarContas} disabled={busy} className="w-full py-2 rounded-lg border border-border bg-white text-[12px] font-bold cursor-pointer">
                  Buscar contas a receber
                </button>
                <button type="button" onClick={disconnectOmie} className="w-full py-1.5 text-[11.5px] font-semibold text-textSecondary cursor-pointer bg-transparent border-none">
                  Desconectar
                </button>
              </div>
            ) : c.key === 'omie' && omieForm ? (
              <div className="flex flex-col gap-2">
                <input value={appKey} onChange={(e) => setAppKey(e.target.value)} placeholder="app_key" className="border border-border rounded-md px-2.5 py-2 text-[12.5px]" />
                <input value={appSecret} onChange={(e) => setAppSecret(e.target.value)} placeholder="app_secret" type="password" className="border border-border rounded-md px-2.5 py-2 text-[12.5px]" />
                {omieError && <div className="text-[11px] text-red-600">{omieError}</div>}
                <Button variant="primary" disabled={busy || !appKey || !appSecret} onClick={connectOmie}>
                  Validar e conectar
                </Button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => (c.key === 'omie' ? setOmieForm(true) : toggleConnector(c.key))}
                className="w-full py-2.5 rounded-lg border-none text-[13px] font-bold cursor-pointer"
                style={{ background: c.connected ? '#EAF3EE' : '#1E5EFF', color: c.connected ? '#0A5C36' : '#fff' }}
              >
                {c.btnLabel}
              </button>
            )}
          </Card>
        ))}
      </div>

      {contas && (
        <Card className="mb-4">
          <div className="font-bold text-[15px] mb-3.5">Contas a receber importadas da Omie ({contas.length})</div>
          {contas.length === 0 ? (
            <div className="text-[13px] text-textSecondary">Nenhuma conta a receber em aberto encontrada na sua conta Omie.</div>
          ) : (
            <div className="flex flex-col gap-2">
              {contas.map((c) => (
                <div key={c.codigoLancamento} className="flex items-center justify-between gap-3 p-2.5 rounded-md bg-[#F7F8FA] text-[12.5px]">
                  <div>{c.cliente} — doc. {c.numeroDocumento}</div>
                  <div className="font-mono-num font-semibold">
                    R$ {c.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} · vence {c.vencimento}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      <NavyCard className="flex items-center justify-between gap-4 flex-wrap mb-4">
        <div>
          <div className="font-bold text-[15px] mb-1.5">Programa white-label para sacados grandes</div>
          <div className="text-[#9FB3D6] text-[13.5px] leading-relaxed max-w-[600px]">
            Ofereça antecipação de recebíveis aos seus próprios fornecedores com sua marca, cores e URL — a Lastro cuida da infraestrutura por trás.
          </div>
        </div>
        <Toggle on={data.whitelabelOn} onClick={() => toggleConnector('whitelabel')} size="lg" />
      </NavyCard>

      <Card>
        <div className="font-bold text-[15px] mb-3.5">Por que integrar direto do ERP</div>
        <div className="flex flex-col gap-2.5">
          {[
            'Elimina digitação manual e risco de erro humano no cadastro da duplicata',
            'Você mantém o "botão de comando" — opt-in e decisão de antecipar continuam com seu financeiro',
            'Aprovação em minutos, dinheiro na conta em até 24h após o leilão fechar',
          ].map((t) => (
            <div key={t} className="flex items-center gap-2.5 text-[13.5px]">
              <span className="rounded-full bg-blue flex-shrink-0" style={{ width: 6, height: 6 }} />
              {t}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
