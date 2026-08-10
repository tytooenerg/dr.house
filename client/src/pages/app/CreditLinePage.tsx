import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { PageHeader, Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';

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

export function CreditLinePage() {
  const [overview, setOverview] = useState<CreditLineOverview | null>(null);
  const [valor, setValor] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = () => api.get<CreditLineOverview>('/credit-line').then(setOverview);

  useEffect(() => {
    load();
  }, []);

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
        subtitle="Antecipação de capital de giro contra o seu próprio histórico real de emissões na Lastro — não é a compra de uma duplicata específica por um investidor, é capital de giro rotativo baseado no seu volume e score reais dos últimos 90 dias"
      />

      {!overview ? null : !overview.eligible ? (
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
