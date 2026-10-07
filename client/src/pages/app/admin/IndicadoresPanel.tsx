import { Card } from '../../../components/ui/Card';
import { ErrorState } from '../../../components/ui/ErrorState';
import { PageSkeleton } from '../../../components/ui/Skeleton';
import { PALETTE } from '../../../lib/palette';
import { useApi } from '../../../lib/useApi';

// Os indicadores que o plano de ação manda olhar todo mês, na mesma tela. Abaixo de 70% de
// leilões com lance o gargalo é comprador (fundo/banco), não cedente — é o gatilho de revisão
// do plano, por isso o número fica vermelho.
const MINIMO_LEILOES_COM_LANCE = 70;

interface IndicadoresMes {
  mes: string;
  mesLabel: string;
  volume: number;
  volumeFmt: string;
  operacoes: number;
  cedentesAtivos: number;
  compradoresAtivos: number;
  leiloesEncerrados: number;
  leiloesComLance: number;
  pctLeiloesComLance: number | null;
  desagioMedioAm: number | null;
  prazoMedioDias: number | null;
  receita: number;
  receitaFmt: string;
}

interface IndicadoresNegocio {
  meses: IndicadoresMes[];
  carteira: {
    emDiaValorFmt: string;
    vencidoValor: number;
    vencidoValorFmt: string;
    pctVencido: number | null;
    sinistrosAbertos: number;
  };
  naoMedidos: string[];
}

function pct(n: number | null) {
  return n === null ? '—' : `${n.toFixed(1).replace('.', ',')}%`;
}

function taxa(n: number | null) {
  return n === null ? '—' : `${n.toFixed(2).replace('.', ',')}% a.m.`;
}

function dias(n: number | null) {
  return n === null ? '—' : `${n} dias`;
}

function corLeiloes(n: number | null) {
  if (n === null) return undefined;
  return n < MINIMO_LEILOES_COM_LANCE ? PALETTE.red : PALETTE.green;
}

function Numero({ rotulo, valor, detalhe, cor }: { rotulo: string; valor: string; detalhe?: string; cor?: string }) {
  return (
    <div className="border border-border rounded-lg p-3.5">
      <div className="text-[11.5px] font-bold uppercase text-textSecondary">{rotulo}</div>
      <div className="text-[20px] font-extrabold font-mono-num mt-1" style={cor ? { color: cor } : undefined}>
        {valor}
      </div>
      {detalhe && <div className="text-[12px] text-textMuted mt-0.5">{detalhe}</div>}
    </div>
  );
}

export function IndicadoresPanel() {
  const { data, error, reload } = useApi<IndicadoresNegocio>('/admin/indicadores', { fallbackMessage: 'Falha ao carregar os indicadores.' });

  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <PageSkeleton />;

  const atual = data.meses.at(-1)!;
  const historico = [...data.meses].reverse();

  return (
    <>
      <Card className="mb-5">
        <div className="font-bold text-[15px]">Indicadores do mês — {atual.mesLabel}</div>
        <div className="text-[12.5px] text-textMuted mt-0.5 mb-4">
          Só operações reais (sandbox fica de fora). Volume = valor de face das duplicatas antecipadas no mês; revenda no secundário não conta como volume novo.
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Numero rotulo="Volume (GMV)" valor={atual.volumeFmt} detalhe={`${atual.operacoes} operação(ões)`} />
          <Numero rotulo="Receita" valor={atual.receitaFmt} detalhe="taxa de plataforma" />
          <Numero rotulo="Cedentes ativos" valor={String(atual.cedentesAtivos)} detalhe="antecipadas no mês" />
          <Numero rotulo="Fundos e bancos ativos" valor={String(atual.compradoresAtivos)} detalhe="deram lance no mês" />
          <Numero
            rotulo="Leilões com lance"
            valor={pct(atual.pctLeiloesComLance)}
            detalhe={`${atual.leiloesComLance} de ${atual.leiloesEncerrados} encerrados`}
            cor={corLeiloes(atual.pctLeiloesComLance)}
          />
          <Numero rotulo="Deságio médio" valor={taxa(atual.desagioMedioAm)} detalhe="lance vencedor, ponderado por valor" />
          <Numero rotulo="Prazo médio" valor={dias(atual.prazoMedioDias)} detalhe="da antecipação ao vencimento" />
        </div>
        {atual.pctLeiloesComLance !== null && atual.pctLeiloesComLance < MINIMO_LEILOES_COM_LANCE && (
          <div className="text-[12.5px] rounded-md p-3 mt-3" style={{ background: PALETTE.redBg, color: PALETTE.red }}>
            Menos de {MINIMO_LEILOES_COM_LANCE}% dos leilões receberam lance: o gargalo são fundos e bancos comprando, não cedentes.
          </div>
        )}
      </Card>

      <Card className="mb-5">
        <div className="font-bold text-[15px] mb-3">Últimos {data.meses.length} meses</div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px] min-w-[720px]">
            <thead>
              <tr className="text-left text-[11.5px] uppercase text-textSecondary border-b border-border">
                <th className="py-2 pr-3">Mês</th>
                <th className="py-2 pr-3 text-right">Volume</th>
                <th className="py-2 pr-3 text-right">Operações</th>
                <th className="py-2 pr-3 text-right">Cedentes</th>
                <th className="py-2 pr-3 text-right">Fundos/bancos</th>
                <th className="py-2 pr-3 text-right">Leilões c/ lance</th>
                <th className="py-2 pr-3 text-right">Deságio</th>
                <th className="py-2 pr-3 text-right">Prazo</th>
                <th className="py-2 text-right">Receita</th>
              </tr>
            </thead>
            <tbody>
              {historico.map((m) => (
                <tr key={m.mes} className="border-b border-hairline last:border-b-0">
                  <td className="py-2 pr-3 font-bold">{m.mesLabel}</td>
                  <td className="py-2 pr-3 text-right font-mono-num">{m.volumeFmt}</td>
                  <td className="py-2 pr-3 text-right font-mono-num">{m.operacoes}</td>
                  <td className="py-2 pr-3 text-right font-mono-num">{m.cedentesAtivos}</td>
                  <td className="py-2 pr-3 text-right font-mono-num">{m.compradoresAtivos}</td>
                  <td className="py-2 pr-3 text-right font-mono-num" style={{ color: corLeiloes(m.pctLeiloesComLance) }}>
                    {pct(m.pctLeiloesComLance)}
                  </td>
                  <td className="py-2 pr-3 text-right font-mono-num">{taxa(m.desagioMedioAm)}</td>
                  <td className="py-2 pr-3 text-right font-mono-num">{dias(m.prazoMedioDias)}</td>
                  <td className="py-2 text-right font-mono-num">{m.receitaFmt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="mb-5">
        <div className="font-bold text-[15px]">Carteira em aberto — hoje</div>
        <div className="text-[12.5px] text-textMuted mt-0.5 mb-4">Duplicatas já antecipadas e ainda não pagas pelo sacado.</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Numero rotulo="Em dia" valor={data.carteira.emDiaValorFmt} />
          <Numero rotulo="Vencido e não pago" valor={data.carteira.vencidoValorFmt} cor={data.carteira.vencidoValor > 0 ? PALETTE.amber : undefined} />
          <Numero rotulo="% vencido" valor={pct(data.carteira.pctVencido)} />
          <Numero rotulo="Sinistros abertos" valor={String(data.carteira.sinistrosAbertos)} detalhe="aguardando a seguradora" />
        </div>
      </Card>

      <Card>
        <div className="font-bold text-[15px] mb-2">Fora da plataforma</div>
        <div className="text-[12.5px] text-textMuted mb-2">Indicadores do plano de ação que dependem de dado que a plataforma não recebe — acompanhe por fora:</div>
        <ul className="list-disc pl-5 text-[13px] text-textSecondary space-y-1">
          {data.naoMedidos.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </Card>
    </>
  );
}
