import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { PageHeader, Card } from '../../components/ui/Card';
import { Field, Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { ErrorState } from '../../components/ui/ErrorState';
import { useSession } from '../../state/SessionContext';
import { PALETTE } from '../../lib/palette';

interface FundoOverview {
  balanceFmt: string;
  navFmt: string;
  cotaPriceFmt: string;
  yourPositionFmt: string | null;
  yourPrincipalAportadoFmt: string | null;
  yourAvailableToRedeemFmt: string | null;
}

// Capital real de investidores financia cada compra automática dentro de um Programa
// Confirming (feature seguinte) — sem aporte no pool, não há como financiar nada. Mesmo
// mecanismo de cota/NAV do pool de fomento da linha de crédito (CreditLinePage.tsx), num
// pool deliberadamente separado.
function FundoCard() {
  const { user } = useSession();
  const isInvestor = user?.role === 'investidor';
  const [fundo, setFundo] = useState<FundoOverview | null>(null);
  const [valor, setValor] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = () => {
    setLoadError(null);
    return api
      .get<FundoOverview>('/confirming-fundo')
      .then(setFundo)
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : 'Falha ao carregar o fundo de fomento.'));
  };

  useEffect(() => {
    load();
  }, []);

  const parsed = Number(valor.replace(',', '.'));

  const contribuir = async () => {
    setError('');
    setNotice('');
    if (!parsed || parsed <= 0) {
      setError('Informe um valor válido para aportar.');
      return;
    }
    setBusy(true);
    try {
      await api.post('/confirming-fundo/contribuir', { valor: parsed });
      setValor('');
      setNotice('Aporte registrado — valor debitado do seu extrato.');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível registrar o aporte.');
    } finally {
      setBusy(false);
    }
  };

  const resgatar = async () => {
    setError('');
    setNotice('');
    if (!parsed || parsed <= 0) {
      setError('Informe um valor válido para resgatar.');
      return;
    }
    setBusy(true);
    try {
      await api.post('/confirming-fundo/resgatar', { valor: parsed });
      setValor('');
      setNotice('Resgate registrado — valor creditado no seu extrato.');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível registrar o resgate.');
    } finally {
      setBusy(false);
    }
  };

  if (loadError) return <ErrorState message={loadError} onRetry={load} />;
  if (!fundo) return null;

  return (
    <Card className="mb-4">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <div className="font-bold text-[15px]">Fundo de Fomento do Confirming</div>
        <span className="text-[12.5px] font-bold text-textSecondary">
          Saldo do pool: {fundo.balanceFmt} · NAV: {fundo.navFmt} · Cota: {fundo.cotaPriceFmt}
        </span>
      </div>
      <p className="text-[12.5px] text-textSecondary mb-3">
        Financia cada compra automática dentro de um Programa Confirming, num pool separado do fomento à linha de crédito. Cada aporte compra
        cotas ao preço atual; retornos de pagamento voltam ao pool sem emitir novas cotas, então o preço da cota sobe para quem já está
        posicionado.
      </p>
      {isInvestor && (
        <>
          <div className="grid grid-cols-3 gap-4 mb-3">
            <div>
              <div className="text-[11.5px] font-bold text-textSecondary uppercase mb-1">Sua posição (com rendimento)</div>
              <div className="font-mono-num font-bold text-[15px]">{fundo.yourPositionFmt}</div>
            </div>
            <div>
              <div className="text-[11.5px] font-bold text-textSecondary uppercase mb-1">Principal aportado</div>
              <div className="font-mono-num font-bold text-[15px] text-textSecondary">{fundo.yourPrincipalAportadoFmt}</div>
            </div>
            <div>
              <div className="text-[11.5px] font-bold text-textSecondary uppercase mb-1">Disponível para resgate</div>
              <div className="font-mono-num font-bold text-[15px] text-blue">{fundo.yourAvailableToRedeemFmt}</div>
            </div>
          </div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <input
              type="text"
              inputMode="decimal"
              placeholder="Valor em R$"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              className="border border-border rounded-md px-3 py-2 text-sm w-48"
            />
            <Button disabled={busy} onClick={contribuir}>
              Aportar
            </Button>
            <Button disabled={busy} onClick={resgatar}>
              Resgatar
            </Button>
          </div>
          {error && <div className="mt-2.5 text-red text-[12.5px] font-semibold">{error}</div>}
          {notice && <div className="mt-2.5 text-green text-[12.5px] font-semibold">{notice}</div>}
        </>
      )}
    </Card>
  );
}

interface MembroView {
  id: number;
  cedenteNome: string;
  cedenteEmail: string;
  sublimiteFmt: string | null;
  status: 'ativo' | 'removido';
}

interface ProgramaView {
  id: number;
  sacadoCnpj: string;
  rating: string;
  taxaAmFmt: string;
  limiteFmt: string;
  utilizadoFmt: string;
  disponivelFmt: string;
  status: 'ativo' | 'pausado';
  membros: MembroView[];
}

interface CedenteElegivel {
  cedenteUserId: number;
  cedenteNome: string;
  volumeHistoricoFmt: string;
  sublimiteSugeridoFmt: string;
  disputasAbertas: number;
  jaMatriculado: boolean;
}

// Programa Confirming / Risco Sacado — o sacado pré-aprova um programa de financiamento
// pra sua cadeia de fornecedores, na taxa da própria classificação de risco. Esta é a
// fundação: criar/pausar o programa e matricular cedentes com histórico real de aceite
// contra este sacado (listarCedentesElegiveis, server-side). O financiamento automático
// em si acontece depois, dentro do leilão/marketplace real — o Fundo de Fomento compra
// como qualquer outro investidor (server/src/lib/confirmingFundoAutoBuy.ts), nunca por
// um atalho na emissão.
export function ConfirmingPage() {
  const { user } = useSession();
  const isSacado = user?.role === 'sacado';
  const [programa, setPrograma] = useState<ProgramaView | null>(null);
  const [cnpj, setCnpj] = useState('');
  const [limite, setLimite] = useState('');
  const [elegiveis, setElegiveis] = useState<CedenteElegivel[]>([]);
  const [sublimiteById, setSublimiteById] = useState<Record<number, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = () =>
    api.get<{ programa: ProgramaView | null; cnpjAtual: string }>('/confirming/meu-programa').then((d) => {
      setPrograma(d.programa);
      setCnpj((c) => c || d.cnpjAtual);
    });

  const loadElegiveis = () => api.get<{ elegiveis: CedenteElegivel[] }>('/confirming/elegiveis').then((d) => setElegiveis(d.elegiveis));

  const loadAll = () => {
    setLoadError(null);
    Promise.all([load(), loadElegiveis()]).catch((err) => setLoadError(err instanceof ApiError ? err.message : 'Falha ao carregar seu Programa Confirming.'));
  };

  useEffect(() => {
    if (isSacado) loadAll();
  }, [isSacado]);

  const run = async (key: string, fn: () => Promise<void>, fallbackMessage: string) => {
    if (busyKey) return;
    setError('');
    setNotice('');
    setBusyKey(key);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : fallbackMessage);
    } finally {
      setBusyKey(null);
    }
  };

  const criar = () =>
    run(
      'criar',
      async () => {
        const p = await api.post<ProgramaView>('/confirming/criar', { cnpj, limite });
        setPrograma(p);
        setNotice('Programa criado — a taxa foi calculada a partir da sua própria classificação de risco.');
        await loadElegiveis();
      },
      'Não foi possível criar o programa.'
    );

  const pausar = () =>
    run(
      'pausar',
      async () => {
        setPrograma(await api.post<ProgramaView>('/confirming/pausar'));
      },
      'Não foi possível pausar o programa.'
    );

  const reativar = () =>
    run(
      'reativar',
      async () => {
        setPrograma(await api.post<ProgramaView>('/confirming/reativar'));
      },
      'Não foi possível reativar o programa.'
    );

  const matricular = (cedenteUserId: number) =>
    run(
      `matricular:${cedenteUserId}`,
      async () => {
        const p = await api.post<ProgramaView>('/confirming/membros', { cedenteUserId, sublimite: sublimiteById[cedenteUserId] || null });
        setPrograma(p);
        await loadElegiveis();
      },
      'Não foi possível matricular este cedente.'
    );

  const remover = (membroId: number) =>
    run(
      `remover:${membroId}`,
      async () => {
        const p = await api.post<ProgramaView>(`/confirming/membros/${membroId}/remover`);
        setPrograma(p);
        await loadElegiveis();
      },
      'Não foi possível remover este cedente.'
    );

  return (
    <div>
      <PageHeader
        title="Programa Confirming"
        subtitle={
          isSacado
            ? 'Pré-aprove financiamento para a sua cadeia de fornecedores, na sua própria taxa de risco'
            : 'Aporte capital no fundo que financia cada compra automática dentro de um Programa Confirming'
        }
      />

      <FundoCard />

      {isSacado && loadError && <ErrorState message={loadError} onRetry={loadAll} />}

      {isSacado && !loadError && (
        <>
          {error && <div className="mb-4 px-3.5 py-3 rounded-lg bg-redBg text-red text-sm font-semibold">{error}</div>}
          {notice && <div className="mb-4 px-3.5 py-3 rounded-lg bg-greenBg text-green text-sm font-semibold">{notice}</div>}

          {!programa ? (
        <Card className="mb-4 max-w-[560px]">
          <div className="font-bold text-[15px] mb-1">Criar meu Programa Confirming</div>
          <div className="text-textSecondary text-[12.5px] mb-4">
            A taxa é calculada a partir da classificação de risco real da sua empresa (mesma banda que já se aplicaria a você no mercado
            aberto) — você define apenas o limite total do programa.
          </div>
          <div className="flex flex-col gap-3.5">
            <Field label="CNPJ da sua empresa">
              <Input placeholder="00.000.000/0001-00" value={cnpj} onChange={(e) => setCnpj(e.target.value)} />
            </Field>
            <Field label="Limite total do programa (R$)">
              <Input mono placeholder="500.000" value={limite} onChange={(e) => setLimite(e.target.value)} />
            </Field>
            <Button onClick={criar} disabled={busyKey === 'criar'}>
              {busyKey === 'criar' ? 'Criando…' : 'Criar programa'}
            </Button>
          </div>
        </Card>
      ) : (
        <>
          <Card className="mb-4">
            <div className="flex items-center justify-between flex-wrap gap-3 mb-1">
              <div className="font-bold text-[15px]">Meu programa — rating {programa.rating}</div>
              <span
                className="text-[11.5px] font-bold px-2.5 py-1 rounded-md"
                style={programa.status === 'ativo' ? { background: PALETTE.greenBg, color: PALETTE.green } : { background: PALETTE.hairline, color: PALETTE.textSecondary }}
              >
                {programa.status === 'ativo' ? 'Ativo' : 'Pausado'}
              </span>
            </div>
            <div className="grid gap-4 mt-3.5" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
              <div>
                <div className="text-textSecondary text-xs font-semibold">Taxa</div>
                <div className="text-lg font-extrabold font-mono-num mt-0.5">{programa.taxaAmFmt}</div>
              </div>
              <div>
                <div className="text-textSecondary text-xs font-semibold">Limite</div>
                <div className="text-lg font-extrabold font-mono-num mt-0.5">{programa.limiteFmt}</div>
              </div>
              <div>
                <div className="text-textSecondary text-xs font-semibold">Utilizado</div>
                <div className="text-lg font-extrabold font-mono-num mt-0.5">{programa.utilizadoFmt}</div>
              </div>
              <div>
                <div className="text-textSecondary text-xs font-semibold">Disponível</div>
                <div className="text-lg font-extrabold font-mono-num mt-0.5 text-green">{programa.disponivelFmt}</div>
              </div>
            </div>
            <div className="mt-4">
              {programa.status === 'ativo' ? (
                <Button variant="secondary" size="sm" onClick={pausar} disabled={busyKey === 'pausar'}>
                  {busyKey === 'pausar' ? 'Pausando…' : 'Pausar programa'}
                </Button>
              ) : (
                <Button size="sm" onClick={reativar} disabled={busyKey === 'reativar'}>
                  {busyKey === 'reativar' ? 'Reativando…' : 'Reativar programa'}
                </Button>
              )}
            </div>
          </Card>

          <div className="grid gap-4" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <Card>
              <div className="font-bold text-[14px] mb-1">Fornecedores matriculados</div>
              <div className="text-textSecondary text-[12.5px] mb-3.5">Cedentes que já podem ser financiados dentro do seu programa</div>
              {programa.membros.filter((m) => m.status === 'ativo').length === 0 ? (
                <div className="text-textSecondary text-[12.5px]">Nenhum fornecedor matriculado ainda.</div>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {programa.membros
                    .filter((m) => m.status === 'ativo')
                    .map((m) => (
                      <div key={m.id} className="flex items-center justify-between gap-2 p-3 rounded-[10px] bg-bg">
                        <div>
                          <div className="font-semibold text-[13px]">{m.cedenteNome}</div>
                          <div className="text-textSecondary text-[11.5px]">{m.cedenteEmail}{m.sublimiteFmt ? ` · sublimite ${m.sublimiteFmt}` : ''}</div>
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => remover(m.id)} disabled={busyKey === `remover:${m.id}`}>
                          {busyKey === `remover:${m.id}` ? 'Removendo…' : 'Remover'}
                        </Button>
                      </div>
                    ))}
                </div>
              )}
            </Card>

            <Card>
              <div className="font-bold text-[14px] mb-1">Fornecedores elegíveis</div>
              <div className="text-textSecondary text-[12.5px] mb-3.5">Cedentes com histórico real de duplicatas contra sua empresa</div>
              {elegiveis.length === 0 ? (
                <div className="text-textSecondary text-[12.5px]">Nenhum cedente com histórico contra sua empresa ainda.</div>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {elegiveis.map((c) => (
                    <div key={c.cedenteUserId} className="flex items-center justify-between gap-2 p-3 rounded-[10px] bg-bg">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-[13px]">{c.cedenteNome}</span>
                          {c.disputasAbertas > 0 && (
                            <span className="text-[10.5px] font-bold px-1.5 py-0.5 rounded-md bg-redBg text-red">
                              {c.disputasAbertas} disputa{c.disputasAbertas > 1 ? 's' : ''} em aberto
                            </span>
                          )}
                        </div>
                        <div className="text-textSecondary text-[11.5px]">Histórico: {c.volumeHistoricoFmt} · sugestão de sublimite: {c.sublimiteSugeridoFmt}</div>
                      </div>
                      {c.jaMatriculado ? (
                        <span className="text-[11.5px] font-bold text-green">Matriculado</span>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <input
                            placeholder={`Sublimite (sugestão: ${c.sublimiteSugeridoFmt})`}
                            value={sublimiteById[c.cedenteUserId] ?? ''}
                            onChange={(e) => setSublimiteById((s) => ({ ...s, [c.cedenteUserId]: e.target.value }))}
                            className="w-[180px] px-2.5 py-1.5 rounded-md border border-inputBorder text-[12.5px] outline-none"
                          />
                          <Button size="sm" onClick={() => matricular(c.cedenteUserId)} disabled={busyKey === `matricular:${c.cedenteUserId}`}>
                            {busyKey === `matricular:${c.cedenteUserId}` ? 'Matriculando…' : 'Matricular'}
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </>
      )}
        </>
      )}
    </div>
  );
}
