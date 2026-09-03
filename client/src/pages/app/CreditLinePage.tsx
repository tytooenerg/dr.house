import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { PageHeader, Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { ErrorState } from '../../components/ui/ErrorState';
import { useSession } from '../../state/SessionContext';

interface DrawRow {
  id: number;
  valorOriginalFmt: string;
  saldoDevedorFmt: string;
  taxaAmFmt: string;
  status: string;
  criadoEm: string;
}

interface CreditLineOverview {
  eligible: boolean;
  motivo?: string;
  rating?: string;
  limiteFmt: string;
  utilizadoFmt: string;
  disponivelFmt: string;
  taxaAmFmt: string;
  disponivel: number;
  draws: DrawRow[];
}

interface FundLedgerRow {
  tipo: string;
  valorFmt: string;
  descricao: string;
  quando: string;
}

interface FundOverview {
  balanceFmt: string;
  navFmt: string;
  cotaPriceFmt: string;
  yourPositionFmt: string | null;
  yourPrincipalAportadoFmt: string | null;
  yourAvailableToRedeemFmt: string | null;
  recentLedger: FundLedgerRow[];
}

// A real pool, funded by investor contributions, is what actually finances every draw below
// (lib/creditLineFund.ts) — not Lastro's own unlimited capital. Cedentes see the pool's live
// balance for context (a draw can be rejected for lack of pool liquidity, not just for
// exceeding their own limit); investidores see the contribute/redeem controls.
function FundCard() {
  const { user } = useSession();
  const isInvestor = user?.role === 'investidor';
  const [fund, setFund] = useState<FundOverview | null>(null);
  const [valor, setValor] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = () => {
    setLoadError(null);
    return api
      .get<FundOverview>('/credit-line-fund')
      .then(setFund)
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : 'Falha ao carregar o pool de fomento.'));
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
      await api.post('/credit-line-fund/contribuir', { valor: parsed });
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
      await api.post('/credit-line-fund/resgatar', { valor: parsed });
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
  if (!fund) return null;

  return (
    <Card className="mb-6">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <div className="font-bold text-[15px]">Pool de fomento à linha de crédito</div>
        <span className="text-[12.5px] font-bold text-textSecondary">
          Saldo do pool: {fund.balanceFmt} · NAV: {fund.navFmt} · Cota: {fund.cotaPriceFmt}
        </span>
      </div>
      <p className="text-[12.5px] text-textSecondary mb-3">
        Capital real de investidores financia cada saque de cedente na linha de crédito rotativa — sem aporte no pool, não há saque possível.
        Cada aporte compra cotas ao preço atual; devoluções (principal + juros) voltam ao pool sem emitir novas cotas, então o preço da cota sobe
        para quem já está posicionado — o mesmo mecanismo de um FIDC real, atribuindo o rendimento proporcionalmente a cada investidor.
      </p>
      {isInvestor && (
        <>
          <div className="grid grid-cols-3 gap-4 mb-3">
            <div>
              <div className="text-[11px] font-bold text-textSecondary uppercase mb-1">Sua posição (com rendimento)</div>
              <div className="font-mono-num font-bold text-[15px]">{fund.yourPositionFmt}</div>
            </div>
            <div>
              <div className="text-[11px] font-bold text-textSecondary uppercase mb-1">Principal aportado</div>
              <div className="font-mono-num font-bold text-[15px] text-textSecondary">{fund.yourPrincipalAportadoFmt}</div>
            </div>
            <div>
              <div className="text-[11px] font-bold text-textSecondary uppercase mb-1">Disponível para resgate</div>
              <div className="font-mono-num font-bold text-[15px] text-blue">{fund.yourAvailableToRedeemFmt}</div>
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

export function CreditLinePage() {
  const { user } = useSession();
  const isCedente = user?.role === 'cedente';
  const [overview, setOverview] = useState<CreditLineOverview | null>(null);
  const [valor, setValor] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = () => {
    setLoadError(null);
    return api
      .get<CreditLineOverview>('/credit-line')
      .then(setOverview)
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : 'Falha ao carregar sua linha de crédito.'));
  };

  useEffect(() => {
    if (isCedente) load();
  }, [isCedente]);

  const parsed = Number(valor.replace(',', '.'));

  const draw = async () => {
    setError('');
    setNotice('');
    if (!parsed || parsed <= 0) {
      setError('Informe um valor válido para saque.');
      return;
    }
    setBusy(true);
    try {
      await api.post('/credit-line/draw', { valor: parsed });
      setValor('');
      setNotice('Saque realizado — valor creditado no seu extrato.');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível realizar o saque.');
    } finally {
      setBusy(false);
    }
  };

  const repay = async () => {
    setError('');
    setNotice('');
    if (!parsed || parsed <= 0) {
      setError('Informe um valor válido para pagamento.');
      return;
    }
    setBusy(true);
    try {
      await api.post('/credit-line/repay', { valor: parsed });
      setValor('');
      setNotice('Pagamento registrado — saldo devedor atualizado.');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível registrar o pagamento.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Linha de Crédito"
        subtitle="Antecipação de capital de giro contra o seu próprio histórico real de emissões na Lastro, financiada por um pool real de investidores — não é a compra de uma duplicata específica, é capital de giro rotativo baseado no seu volume e score reais dos últimos 90 dias"
      />

      <FundCard />

      {isCedente && loadError && <ErrorState message={loadError} onRetry={load} />}

      {!isCedente ? null : loadError ? null : !overview ? null : !overview.eligible ? (
        <Card>
          <div className="font-bold text-[15px] mb-2">Ainda não elegível</div>
          <p className="text-[12.5px] text-textSecondary">{overview.motivo}</p>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <Card>
              <div className="text-[11.5px] font-bold text-textSecondary uppercase mb-1.5">Limite aprovado</div>
              <div className="font-mono-num font-bold text-lg">{overview.limiteFmt}</div>
              {overview.rating && <div className="text-[11.5px] text-textSecondary mt-1">Rating {overview.rating}</div>}
            </Card>
            <Card>
              <div className="text-[11.5px] font-bold text-textSecondary uppercase mb-1.5">Utilizado</div>
              <div className="font-mono-num font-bold text-lg">{overview.utilizadoFmt}</div>
            </Card>
            <Card>
              <div className="text-[11.5px] font-bold text-textSecondary uppercase mb-1.5">Disponível</div>
              <div className="font-mono-num font-bold text-lg text-blue">{overview.disponivelFmt}</div>
            </Card>
            <Card>
              <div className="text-[11.5px] font-bold text-textSecondary uppercase mb-1.5">Taxa</div>
              <div className="font-mono-num font-bold text-lg">{overview.taxaAmFmt}</div>
            </Card>
          </div>

          <Card className="mb-6">
            <div className="font-bold text-[15px] mb-3">Sacar ou pagar</div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <input
                type="text"
                inputMode="decimal"
                placeholder="Valor em R$"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                className="border border-border rounded-md px-3 py-2 text-sm w-48"
              />
              <Button disabled={busy} onClick={draw}>
                Sacar
              </Button>
              <Button disabled={busy} onClick={repay}>
                Pagar
              </Button>
            </div>
            {error && <div className="mt-2.5 text-red text-[12.5px] font-semibold">{error}</div>}
            {notice && <div className="mt-2.5 text-green text-[12.5px] font-semibold">{notice}</div>}
            <p className="text-[11.5px] text-textSecondary mt-3">
              Juros calculados dia a dia sobre o saldo em aberto, sem capitalização composta dentro do mesmo mês. Pagamentos abatem o saque mais antigo primeiro.
            </p>
          </Card>

          <Card>
            <div className="font-bold text-[15px] mb-3">Saques</div>
            {overview.draws.length === 0 ? (
              <p className="text-[12.5px] text-textSecondary">Nenhum saque realizado ainda.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {overview.draws.map((d) => (
                  <div key={d.id} className="flex items-center justify-between border-b border-border last:border-b-0 pb-2 text-[12.5px]">
                    <span className="text-textSecondary">{d.criadoEm}</span>
                    <span className="font-mono-num">{d.valorOriginalFmt}</span>
                    <span className="font-mono-num font-bold">{d.saldoDevedorFmt}</span>
                    <span className="text-textSecondary">{d.taxaAmFmt}</span>
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md ${d.status === 'quitado' ? 'bg-[#EAF3EE] text-green' : 'bg-[#FBF1E0] text-amber'}`}>
                      {d.status === 'quitado' ? 'Quitado' : 'Em aberto'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
