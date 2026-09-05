import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { PageSkeleton } from '../../components/ui/Skeleton';
import { PageHeader, Card, NavyCard } from '../../components/ui/Card';
import { Toggle } from '../../components/ui/Toggle';
import { Button } from '../../components/ui/Button';
import { ErrorState } from '../../components/ui/ErrorState';
import { PALETTE } from '../../lib/palette';

interface Connector {
  key: string;
  name: string;
  desc: string;
  connected: boolean;
  real: boolean;
  btnLabel: string;
}
interface WhitelabelBrand {
  nome: string;
  corPrimaria: string;
  logoUrl: string;
}
interface ErpData {
  connectors: Connector[];
  whitelabelOn: boolean;
  whitelabelBrand: WhitelabelBrand | null;
  whitelabelPlusEnabled: boolean;
  whitelabelPlusPriceFmt: string;
  omieConnected: boolean;
  sapConnected: boolean;
  totvsConnected: boolean;
  autoEmitEnabled: boolean;
  autoEmitMaxValor: string;
  hasErpConnected: boolean;
  companyCnpj: string;
}
interface ContaReceber {
  id?: string;
  codigoLancamento?: number;
  cliente: string;
  numeroDocumento: string;
  valor: number;
  vencimento: string;
}
interface ContaPagar {
  id?: string;
  codigoLancamento?: number;
  fornecedor: string;
  numeroDocumento: string;
  valor: number;
  vencimento: string;
}
interface ErpDiagnosis {
  causaProvavel: string;
  proximoPasso: string;
}

export function ErpPage() {
  const [data, setData] = useState<ErpData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [omieForm, setOmieForm] = useState(false);
  const [appKey, setAppKey] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [omieError, setOmieError] = useState<string | null>(null);
  const [omieRawError, setOmieRawError] = useState<string | null>(null);

  const [sapForm, setSapForm] = useState(false);
  const [sapBaseUrl, setSapBaseUrl] = useState('');
  const [sapCompanyDb, setSapCompanyDb] = useState('');
  const [sapUsername, setSapUsername] = useState('');
  const [sapPassword, setSapPassword] = useState('');
  const [sapError, setSapError] = useState<string | null>(null);

  const [totvsForm, setTotvsForm] = useState(false);
  const [totvsBaseUrl, setTotvsBaseUrl] = useState('');
  const [totvsClientId, setTotvsClientId] = useState('');
  const [totvsClientSecret, setTotvsClientSecret] = useState('');
  const [totvsError, setTotvsError] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [contas, setContas] = useState<ContaReceber[] | null>(null);
  const [contasFonte, setContasFonte] = useState('');
  const [contasPagar, setContasPagar] = useState<ContaPagar[] | null>(null);
  const [contasPagarFonte, setContasPagarFonte] = useState('');

  const [autoEmitMaxInput, setAutoEmitMaxInput] = useState('');
  const [savingAutoEmit, setSavingAutoEmit] = useState(false);
  const [autoEmitError, setAutoEmitError] = useState('');

  const [brandForm, setBrandForm] = useState(false);
  const [brandNome, setBrandNome] = useState('');
  const [brandCor, setBrandCor] = useState<string>(PALETTE.blue);
  const [brandLogo, setBrandLogo] = useState('');
  const [brandError, setBrandError] = useState('');
  const [savingBrand, setSavingBrand] = useState(false);

  const [whitelabelPlusError, setWhitelabelPlusError] = useState('');

  const [companyCnpjInput, setCompanyCnpjInput] = useState('');
  const [savingCompanyCnpj, setSavingCompanyCnpj] = useState(false);

  // Copiloto de diagnóstico (lib/erpConnectionCopilot.ts) — sob demanda, um diagnóstico por
  // conector por vez. undefined = ainda não pedido, null = IA indisponível, objeto = causa
  // provável + próximo passo, nunca uma decisão automática.
  const [diagnosisByConnector, setDiagnosisByConnector] = useState<Record<string, ErpDiagnosis | null>>({});
  const [diagnosingConnector, setDiagnosingConnector] = useState<string | null>(null);

  const resetDiagnosis = (connector: 'sap' | 'totvs' | 'omie') =>
    setDiagnosisByConnector((prev) => {
      if (!(connector in prev)) return prev;
      const { [connector]: _omit, ...rest } = prev;
      return rest;
    });

  const diagnose = async (connector: 'sap' | 'totvs' | 'omie', rawError: string) => {
    setDiagnosingConnector(connector);
    try {
      const res = await api.post<{ diagnosis: ErpDiagnosis | null }>('/erp/diagnostico', { connector, error: rawError });
      setDiagnosisByConnector((prev) => ({ ...prev, [connector]: res.diagnosis }));
    } finally {
      setDiagnosingConnector(null);
    }
  };

  function renderDiagnosisBlock(connector: 'sap' | 'totvs' | 'omie', rawError: string) {
    const diagnosis = diagnosisByConnector[connector];
    if (diagnosis === undefined) {
      return (
        <button
          type="button"
          disabled={diagnosingConnector === connector}
          onClick={() => diagnose(connector, rawError)}
          className="w-full py-1.5 rounded-md border border-inputBorder bg-white text-[11.5px] font-bold cursor-pointer"
        >
          {diagnosingConnector === connector ? 'Diagnosticando…' : 'Diagnosticar com IA (sugestão, não corrige sozinha)'}
        </button>
      );
    }
    if (!diagnosis) {
      return <div className="text-[11.5px] text-textSecondary">Diagnóstico indisponível (ANTHROPIC_API_KEY não configurada no servidor).</div>;
    }
    return (
      <div className="rounded-md px-3 py-2.5 bg-chip text-[11.5px] flex flex-col gap-1">
        <div>
          <b>Causa provável:</b> {diagnosis.causaProvavel}
        </div>
        <div>
          <b>Próximo passo:</b> {diagnosis.proximoPasso}
        </div>
      </div>
    );
  }

  const load = () => {
    setLoadError(null);
    return api
      .get<ErpData>('/erp')
      .then((d) => {
        setData(d);
        setAutoEmitMaxInput(d.autoEmitMaxValor);
        setCompanyCnpjInput(d.companyCnpj);
        if (d.whitelabelBrand) {
          setBrandNome(d.whitelabelBrand.nome);
          setBrandCor(d.whitelabelBrand.corPrimaria);
          setBrandLogo(d.whitelabelBrand.logoUrl);
        }
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : 'Falha ao carregar Integrações ERP.'));
  };

  useEffect(() => {
    load();
  }, []);

  if (loadError) return <ErrorState message={loadError} onRetry={load} />;
  if (!data) return <PageSkeleton />;

  const toggleConnector = (key: string) => api.post<ErpData>(`/erp/${key}/toggle`).then(setData);

  const connectOmie = async () => {
    setBusy(true);
    setOmieError(null);
    resetDiagnosis('omie');
    try {
      const d = await api.post<ErpData>('/erp/omie/connect', { appKey, appSecret });
      setData(d);
      setOmieForm(false);
      setAppKey('');
      setAppSecret('');
    } catch (err) {
      setOmieError('Não foi possível validar as credenciais Omie. Confira o app_key/app_secret em Omie > Configurações > API.');
      setOmieRawError(err instanceof ApiError ? err.message : 'omie_auth_failed');
    } finally {
      setBusy(false);
    }
  };

  const disconnectOmie = () => api.post<ErpData>('/erp/omie/disconnect').then((d) => { setData(d); setContas(null); setContasPagar(null); });

  const connectSap = async () => {
    setBusy(true);
    setSapError(null);
    resetDiagnosis('sap');
    try {
      const d = await api.post<ErpData>('/erp/sap/connect', { baseUrl: sapBaseUrl, companyDb: sapCompanyDb, username: sapUsername, password: sapPassword });
      setData(d);
      setSapForm(false);
      setSapBaseUrl('');
      setSapCompanyDb('');
      setSapUsername('');
      setSapPassword('');
    } catch (err) {
      setSapError(err instanceof ApiError ? err.message : 'Não foi possível validar as credenciais SAP.');
    } finally {
      setBusy(false);
    }
  };

  const disconnectSap = () => api.post<ErpData>('/erp/sap/disconnect').then((d) => { setData(d); setContas(null); setContasPagar(null); });

  const connectTotvs = async () => {
    setBusy(true);
    setTotvsError(null);
    resetDiagnosis('totvs');
    try {
      const d = await api.post<ErpData>('/erp/totvs/connect', { baseUrl: totvsBaseUrl, clientId: totvsClientId, clientSecret: totvsClientSecret });
      setData(d);
      setTotvsForm(false);
      setTotvsBaseUrl('');
      setTotvsClientId('');
      setTotvsClientSecret('');
    } catch (err) {
      setTotvsError(err instanceof ApiError ? err.message : 'Não foi possível validar as credenciais TOTVS.');
    } finally {
      setBusy(false);
    }
  };

  const disconnectTotvs = () => api.post<ErpData>('/erp/totvs/disconnect').then((d) => { setData(d); setContas(null); setContasPagar(null); });

  const buscarContas = async (key: 'omie' | 'sap' | 'totvs', label: string) => {
    setBusy(true);
    try {
      const res = await api.get<{ contas: ContaReceber[] }>(`/erp/${key}/contas-receber`);
      setContas(res.contas);
      setContasFonte(label);
    } finally {
      setBusy(false);
    }
  };

  // Feature "Contas a Pagar via ERP" — mesma ideia de buscarContas, mas o backend persiste
  // direto na tabela payables (upsertErpPayables), então o resultado também aparece em
  // Contas a Pagar e entra na projeção do AI CFO sem precisar de nenhuma ação a mais aqui.
  const buscarContasPagar = async (key: 'omie' | 'sap' | 'totvs', label: string) => {
    setBusy(true);
    try {
      const res = await api.get<{ contas: ContaPagar[] }>(`/erp/${key}/contas-pagar`);
      setContasPagar(res.contas);
      setContasPagarFonte(label);
    } finally {
      setBusy(false);
    }
  };

  const saveAutoEmit = async (enabled: boolean) => {
    setSavingAutoEmit(true);
    setAutoEmitError('');
    try {
      const d = await api.post<ErpData>('/erp/auto-emit', { enabled, maxValor: autoEmitMaxInput });
      setData(d);
    } catch (err) {
      setAutoEmitError(err instanceof ApiError ? err.message : 'Não foi possível atualizar a emissão automática.');
    } finally {
      setSavingAutoEmit(false);
    }
  };

  const saveCompanyCnpj = async () => {
    setSavingCompanyCnpj(true);
    try {
      const d = await api.post<ErpData>('/erp/company-cnpj', { cnpj: companyCnpjInput });
      setData(d);
    } finally {
      setSavingCompanyCnpj(false);
    }
  };

  const saveBrand = async () => {
    setSavingBrand(true);
    setBrandError('');
    try {
      const d = await api.post<ErpData>('/erp/whitelabel/brand', { nome: brandNome, corPrimaria: brandCor, logoUrl: brandLogo });
      setData(d);
      setBrandForm(false);
    } catch (err) {
      setBrandError(err instanceof ApiError ? err.message : 'Não foi possível salvar a marca.');
    } finally {
      setSavingBrand(false);
    }
  };

  const removeBrand = () => api.post<ErpData>('/erp/whitelabel/brand/remove').then(setData);

  const toggleWhitelabelPlus = async (enabled: boolean) => {
    setWhitelabelPlusError('');
    try {
      const d = await api.post<ErpData>('/erp/whitelabel/plus', { enabled });
      setData(d);
    } catch (err) {
      setWhitelabelPlusError(err instanceof ApiError ? err.message : 'Não foi possível atualizar o White-label Plus.');
    }
  };

  return (
    <div>
      <PageHeader title="Integrações ERP" subtitle="Conecte seu sistema de gestão — suas vendas viram duplicatas escriturais automaticamente, sem digitação manual" />

      <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        {data.connectors.map((c) => (
          <Card key={c.key}>
            <div className="w-11 h-11 rounded-[10px] bg-bg flex items-center justify-center font-extrabold text-[15px] text-navy mb-4">{c.name}</div>
            <div className="font-bold text-[15px] mb-2">{c.name}</div>
            <div className="text-textSecondary text-[13px] leading-snug mb-4.5 min-h-14">{c.desc}</div>

            {c.key === 'omie' && c.connected ? (
              <div className="flex flex-col gap-2">
                <button type="button" disabled className="w-full py-2.5 rounded-lg border-none text-[13px] font-bold" style={{ background: PALETTE.greenBg, color: PALETTE.green }}>
                  Conectado ✓
                </button>
                <button type="button" onClick={() => buscarContas('omie', 'Omie')} disabled={busy} className="w-full py-2 rounded-lg border border-border bg-white text-[12.5px] font-bold cursor-pointer">
                  Buscar contas a receber
                </button>
                <button type="button" onClick={() => buscarContasPagar('omie', 'Omie')} disabled={busy} className="w-full py-2 rounded-lg border border-border bg-white text-[12.5px] font-bold cursor-pointer">
                  Buscar contas a pagar
                </button>
                <button type="button" onClick={disconnectOmie} className="w-full py-1.5 text-[11.5px] font-semibold text-textSecondary cursor-pointer bg-transparent border-none">
                  Desconectar
                </button>
              </div>
            ) : c.key === 'omie' && omieForm ? (
              <div className="flex flex-col gap-2">
                <input value={appKey} onChange={(e) => setAppKey(e.target.value)} placeholder="app_key" className="border border-border rounded-md px-2.5 py-2 text-[12.5px]" />
                <input value={appSecret} onChange={(e) => setAppSecret(e.target.value)} placeholder="app_secret" type="password" className="border border-border rounded-md px-2.5 py-2 text-[12.5px]" />
                {omieError && (
                  <>
                    <div className="text-[11.5px] text-red-600">{omieError}</div>
                    {renderDiagnosisBlock('omie', omieRawError ?? omieError)}
                  </>
                )}
                <Button variant="primary" disabled={busy || !appKey || !appSecret} onClick={connectOmie}>
                  Validar e conectar
                </Button>
              </div>
            ) : c.key === 'sap' && c.connected ? (
              <div className="flex flex-col gap-2">
                <button type="button" disabled className="w-full py-2.5 rounded-lg border-none text-[13px] font-bold" style={{ background: PALETTE.greenBg, color: PALETTE.green }}>
                  Conectado ✓
                </button>
                <button type="button" onClick={() => buscarContas('sap', 'SAP Business One')} disabled={busy} className="w-full py-2 rounded-lg border border-border bg-white text-[12.5px] font-bold cursor-pointer">
                  Buscar faturas em aberto
                </button>
                <button type="button" onClick={() => buscarContasPagar('sap', 'SAP Business One')} disabled={busy} className="w-full py-2 rounded-lg border border-border bg-white text-[12.5px] font-bold cursor-pointer">
                  Buscar contas a pagar
                </button>
                <button type="button" onClick={disconnectSap} className="w-full py-1.5 text-[11.5px] font-semibold text-textSecondary cursor-pointer bg-transparent border-none">
                  Desconectar
                </button>
              </div>
            ) : c.key === 'sap' && sapForm ? (
              <div className="flex flex-col gap-2">
                <input value={sapBaseUrl} onChange={(e) => setSapBaseUrl(e.target.value)} placeholder="https://seu-servidor:50000" className="border border-border rounded-md px-2.5 py-2 text-[12.5px]" />
                <input value={sapCompanyDb} onChange={(e) => setSapCompanyDb(e.target.value)} placeholder="CompanyDB" className="border border-border rounded-md px-2.5 py-2 text-[12.5px]" />
                <input value={sapUsername} onChange={(e) => setSapUsername(e.target.value)} placeholder="Usuário" className="border border-border rounded-md px-2.5 py-2 text-[12.5px]" />
                <input value={sapPassword} onChange={(e) => setSapPassword(e.target.value)} placeholder="Senha" type="password" className="border border-border rounded-md px-2.5 py-2 text-[12.5px]" />
                {sapError && (
                  <>
                    <div className="text-[11.5px] text-red-600">{sapError}</div>
                    {renderDiagnosisBlock('sap', sapError)}
                  </>
                )}
                <Button variant="primary" disabled={busy || !sapBaseUrl || !sapCompanyDb || !sapUsername || !sapPassword} onClick={connectSap}>
                  Validar e conectar
                </Button>
              </div>
            ) : c.key === 'totvs' && c.connected ? (
              <div className="flex flex-col gap-2">
                <button type="button" disabled className="w-full py-2.5 rounded-lg border-none text-[13px] font-bold" style={{ background: PALETTE.greenBg, color: PALETTE.green }}>
                  Conectado ✓
                </button>
                <button type="button" onClick={() => buscarContas('totvs', 'TOTVS')} disabled={busy} className="w-full py-2 rounded-lg border border-border bg-white text-[12.5px] font-bold cursor-pointer">
                  Buscar contas a receber
                </button>
                <button type="button" onClick={() => buscarContasPagar('totvs', 'TOTVS')} disabled={busy} className="w-full py-2 rounded-lg border border-border bg-white text-[12.5px] font-bold cursor-pointer">
                  Buscar contas a pagar
                </button>
                <button type="button" onClick={disconnectTotvs} className="w-full py-1.5 text-[11.5px] font-semibold text-textSecondary cursor-pointer bg-transparent border-none">
                  Desconectar
                </button>
              </div>
            ) : c.key === 'totvs' && totvsForm ? (
              <div className="flex flex-col gap-2">
                <input value={totvsBaseUrl} onChange={(e) => setTotvsBaseUrl(e.target.value)} placeholder="https://api.totvs.seudominio.com.br" className="border border-border rounded-md px-2.5 py-2 text-[12.5px]" />
                <input value={totvsClientId} onChange={(e) => setTotvsClientId(e.target.value)} placeholder="client_id" className="border border-border rounded-md px-2.5 py-2 text-[12.5px]" />
                <input value={totvsClientSecret} onChange={(e) => setTotvsClientSecret(e.target.value)} placeholder="client_secret" type="password" className="border border-border rounded-md px-2.5 py-2 text-[12.5px]" />
                {totvsError && (
                  <>
                    <div className="text-[11.5px] text-red-600">{totvsError}</div>
                    {renderDiagnosisBlock('totvs', totvsError)}
                  </>
                )}
                <Button variant="primary" disabled={busy || !totvsBaseUrl || !totvsClientId || !totvsClientSecret} onClick={connectTotvs}>
                  Validar e conectar
                </Button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => (c.key === 'omie' ? setOmieForm(true) : c.key === 'sap' ? setSapForm(true) : c.key === 'totvs' ? setTotvsForm(true) : toggleConnector(c.key))}
                className="w-full py-2.5 rounded-lg border-none text-[13px] font-bold cursor-pointer"
                style={{ background: c.connected ? PALETTE.greenBg : PALETTE.blue, color: c.connected ? PALETTE.green : '#fff' }}
              >
                {c.btnLabel}
              </button>
            )}
          </Card>
        ))}
      </div>

      {contas && (
        <Card className="mb-4">
          <div className="font-bold text-[15px] mb-3.5">
            Contas a receber importadas — {contasFonte} ({contas.length})
          </div>
          {contas.length === 0 ? (
            <div className="text-[13px] text-textSecondary">Nenhuma conta a receber em aberto encontrada.</div>
          ) : (
            <div className="flex flex-col gap-2">
              {contas.map((c, i) => (
                <div key={c.id ?? c.codigoLancamento ?? i} className="flex items-center justify-between gap-3 p-2.5 rounded-md bg-surface text-[12.5px]">
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

      {contasPagar && (
        <Card className="mb-4">
          <div className="font-bold text-[15px] mb-1">
            Contas a pagar importadas — {contasPagarFonte} ({contasPagar.length})
          </div>
          <div className="text-textSecondary text-[12.5px] mb-3.5">Já entram em Contas a Pagar e na projeção do AI CFO — nenhuma ação extra necessária.</div>
          {contasPagar.length === 0 ? (
            <div className="text-[13px] text-textSecondary">Nenhuma conta a pagar em aberto encontrada.</div>
          ) : (
            <div className="flex flex-col gap-2">
              {contasPagar.map((c, i) => (
                <div key={c.id ?? c.codigoLancamento ?? i} className="flex items-center justify-between gap-3 p-2.5 rounded-md bg-surface text-[12.5px]">
                  <div>{c.fornecedor} — doc. {c.numeroDocumento}</div>
                  <div className="font-mono-num font-semibold">
                    R$ {c.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} · vence {c.vencimento}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      <Card className="mb-4">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
          <div className="font-bold text-[15px]">Emissão automática</div>
          <Toggle on={data.autoEmitEnabled} onClick={() => saveAutoEmit(!data.autoEmitEnabled)} />
        </div>
        <div className="text-textSecondary text-[12.5px] mb-3">
          {data.hasErpConnected
            ? 'Novas contas a receber do ERP conectado viram duplicata automaticamente, sem precisar entrar em Emitir Duplicata — até o limite abaixo.'
            : 'Conecte um ERP acima (Omie, SAP ou TOTVS) para poder ativar a emissão automática.'}
        </div>
        <div className="flex items-center gap-2.5">
          <span className="text-[12.5px] text-textSecondary">Limite por emissão:</span>
          <input
            className="w-40 px-3 py-2 rounded-md border border-inputBorder text-[13px]"
            value={autoEmitMaxInput}
            onChange={(e) => setAutoEmitMaxInput(e.target.value)}
          />
          <Button size="sm" variant="secondary" disabled={savingAutoEmit || autoEmitMaxInput === data.autoEmitMaxValor} onClick={() => saveAutoEmit(data.autoEmitEnabled)}>
            {savingAutoEmit ? 'Salvando…' : 'Salvar limite'}
          </Button>
        </div>
        {autoEmitError && <div className="text-red text-[12.5px] font-semibold mt-2">{autoEmitError}</div>}
      </Card>

      <Card className="mb-4">
        <div className="font-bold text-[15px] mb-1">CNPJ da empresa</div>
        <div className="text-textSecondary text-[12.5px] mb-3">
          Usado só pelo AI CFO (plano Empresarial) pra consultar seu saldo bancário real via Open Finance — não é o CNPJ do sacado.
        </div>
        <div className="flex items-center gap-2.5">
          <input
            className="w-64 px-3 py-2 rounded-md border border-inputBorder text-[13px]"
            placeholder="00.000.000/0000-00"
            value={companyCnpjInput}
            onChange={(e) => setCompanyCnpjInput(e.target.value)}
          />
          <Button size="sm" variant="secondary" disabled={savingCompanyCnpj || companyCnpjInput === data.companyCnpj} onClick={saveCompanyCnpj}>
            {savingCompanyCnpj ? 'Salvando…' : 'Salvar'}
          </Button>
        </div>
      </Card>

      <NavyCard className="mb-4">
        <div className="flex items-center justify-between gap-4 flex-wrap mb-3">
          <div>
            <div className="font-bold text-[15px] mb-1.5">Programa white-label para sacados grandes</div>
            <div className="text-onNavy text-[13px] leading-relaxed max-w-[600px]">
              Ofereça antecipação de recebíveis aos seus próprios fornecedores com sua marca, cores e logo — a Lastro cuida da infraestrutura por trás.
              Disponível no plano Empresarial.
            </div>
          </div>
        </div>
        {data.whitelabelBrand && !brandForm ? (
          <div className="flex items-center justify-between gap-3 flex-wrap bg-navy border border-navyBorder rounded-lg p-3.5">
            <div className="flex items-center gap-2.5">
              <span className="rounded-md" style={{ width: 20, height: 20, background: data.whitelabelBrand.corPrimaria }} />
              <span className="font-bold text-[13px]">{data.whitelabelBrand.nome}</span>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" onClick={() => setBrandForm(true)}>
                Editar
              </Button>
              <Button size="sm" variant="danger" onClick={removeBrand}>
                Remover
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <input value={brandNome} onChange={(e) => setBrandNome(e.target.value)} placeholder="Nome da marca" className="flex-1 min-w-[160px] border border-navyBorder bg-navy rounded-md px-2.5 py-2 text-[12.5px] text-white" />
              <input value={brandCor} onChange={(e) => setBrandCor(e.target.value)} placeholder={PALETTE.blue} className="w-28 border border-navyBorder bg-navy rounded-md px-2.5 py-2 text-[12.5px] text-white" />
              <input value={brandLogo} onChange={(e) => setBrandLogo(e.target.value)} placeholder="URL do logo" className="flex-1 min-w-[160px] border border-navyBorder bg-navy rounded-md px-2.5 py-2 text-[12.5px] text-white" />
            </div>
            {brandError && <div className="text-[11.5px]" style={{ color: PALETTE.redOnNavy }}>{brandError}</div>}
            <div className="flex items-center gap-2">
              <Button size="sm" disabled={savingBrand || !brandNome || !brandLogo} onClick={saveBrand}>
                {savingBrand ? 'Salvando…' : 'Salvar marca'}
              </Button>
              {data.whitelabelBrand && (
                <Button size="sm" variant="ghost" onClick={() => setBrandForm(false)}>
                  Cancelar
                </Button>
              )}
            </div>
          </div>
        )}

        {data.whitelabelBrand && (
          <div className="mt-3.5 pt-3.5 border-t border-navyBorder flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="font-bold text-[13px]">White-label Plus</div>
              <div className="text-onNavy text-[12.5px] mt-0.5 max-w-[520px]">
                Estende sua marca à própria tela de aceite do sacado (hoje só o WhatsApp de lembrete é personalizado) — {data.whitelabelPlusPriceFmt}/mês.
              </div>
            </div>
            <Toggle on={data.whitelabelPlusEnabled} onClick={() => toggleWhitelabelPlus(!data.whitelabelPlusEnabled)} />
          </div>
        )}
        {whitelabelPlusError && <div className="text-[11.5px] mt-2" style={{ color: PALETTE.redOnNavy }}>{whitelabelPlusError}</div>}
      </NavyCard>

      <Card>
        <div className="font-bold text-[15px] mb-3.5">Por que integrar direto do ERP</div>
        <div className="flex flex-col gap-2.5">
          {[
            'Elimina digitação manual e risco de erro humano no cadastro da duplicata',
            'Você mantém o "botão de comando" — a emissão automática é opt-in e pode ser desligada a qualquer momento',
            'Aprovação em minutos, dinheiro na conta em até 24h após o leilão fechar',
          ].map((t) => (
            <div key={t} className="flex items-center gap-2.5 text-[13px]">
              <span className="rounded-full bg-blue flex-shrink-0" style={{ width: 6, height: 6 }} />
              {t}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
