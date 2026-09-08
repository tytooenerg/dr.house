import { useState } from 'react';
import { PageHeader, Card } from '../../components/ui/Card';
import { Select } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { Notice } from '../../components/ui/Notice';
import { ErrorState } from '../../components/ui/ErrorState';
import { Table, TableHead, TableBody, TableRow, TableCell } from '../../components/ui/Table';
import { SelfServiceAgentCard } from '../../components/agents/SelfServiceAgentCard';
import { useApi } from '../../lib/useApi';

interface LinhaFiscal {
  duplicataId: string;
  sacado: string;
  dataNegociacao: string;
  valorFaceFmt: string;
  precoRecebidoFmt: string;
  despesaFinanceiraFmt: string;
  taxaPlataformaFmt: string;
  veiculoComprador: string;
  iofIncide: 'sim' | 'nao' | 'indeterminado';
  iofValorFmt: string;
  iofMotivo: string;
}

interface ResumoFiscal {
  ano: number;
  operacoes: number;
  valorFaceTotalFmt: string;
  precoRecebidoTotalFmt: string;
  despesaFinanceiraTotalFmt: string;
  taxaPlataformaTotalFmt: string;
  iofTotalFmt: string;
  iofIndeterminadas: number;
  linhas: LinhaFiscal[];
  aliquotas: { diariaPct: number; adicionalPct: number; origem: string; fonte: string };
  aviso: string;
  avisoRegimeTributario: string;
}

const COLS = '1.2fr 0.7fr 0.8fr 0.8fr 0.9fr 0.8fr';
const ANOS = [0, 1, 2].map((n) => new Date().getFullYear() - n);

export function FiscalPage() {
  const [ano, setAno] = useState(ANOS[0]);
  const { data, error, reload } = useApi<ResumoFiscal>(`/fiscal/resumo?ano=${ano}`, {
    fallbackMessage: 'Falha ao carregar o resumo fiscal.',
  });

  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;

  return (
    <div>
      <PageHeader
        title="Fiscal"
        subtitle="O efeito tributário das suas antecipações, calculado sobre as operações reais desta conta"
        right={
          <Select aria-label="Ano do resumo fiscal" value={ano} onChange={(e) => setAno(Number(e.target.value))}>
            {ANOS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </Select>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
        <Card>
          <div className="text-[11.5px] font-bold text-textSecondary uppercase mb-1.5">Recebido nas antecipações</div>
          <div className="font-mono-num font-bold text-lg text-green">{data.precoRecebidoTotalFmt}</div>
          <div className="text-[11.5px] text-textTertiary mt-1">de {data.valorFaceTotalFmt} em valor de face</div>
        </Card>
        <Card>
          <div className="text-[11.5px] font-bold text-textSecondary uppercase mb-1.5">Deságio (despesa financeira)</div>
          <div className="font-mono-num font-bold text-lg">{data.despesaFinanceiraTotalFmt}</div>
        </Card>
        <Card>
          <div className="text-[11.5px] font-bold text-textSecondary uppercase mb-1.5">Taxa de plataforma</div>
          <div className="font-mono-num font-bold text-lg">{data.taxaPlataformaTotalFmt}</div>
        </Card>
        <Card>
          <div className="text-[11.5px] font-bold text-textSecondary uppercase mb-1.5">IOF estimado</div>
          <div className="font-mono-num font-bold text-lg">{data.iofTotalFmt}</div>
          {data.iofIndeterminadas > 0 && (
            <div className="text-[11.5px] text-amber mt-1">
              {data.iofIndeterminadas} operação(ões) sem incidência determinável
            </div>
          )}
        </Card>
      </div>

      <Notice variant="info" className="mb-4">
        {data.aviso} Alíquotas usadas: {data.aliquotas.diariaPct.toString().replace('.', ',')}% ao dia +{' '}
        {data.aliquotas.adicionalPct.toString().replace('.', ',')}% adicional ({data.aliquotas.fonte}
        {data.aliquotas.origem === 'configurada' ? ', configuradas pela plataforma' : ', valores de referência'}).
      </Notice>

      {data.operacoes === 0 ? (
        <Card>
          <div className="text-[13px] text-textSecondary">Nenhuma duplicata sua foi negociada em {data.ano}.</div>
        </Card>
      ) : (
        <Table label={`Operações de ${data.ano}`}>
          <TableHead columns={COLS} labels={['Sacado', 'Data', 'Você recebeu', 'Deságio', 'Comprador', 'IOF']} />
          <TableBody>
            {data.linhas.map((l) => (
              <TableRow key={l.duplicataId} columns={COLS}>
                <TableCell className="font-semibold">{l.sacado}</TableCell>
                <TableCell className="text-textSecondary">{l.dataNegociacao}</TableCell>
                <TableCell className="font-mono-num font-bold">{l.precoRecebidoFmt}</TableCell>
                <TableCell className="font-mono-num text-textSecondary">{l.despesaFinanceiraFmt}</TableCell>
                <TableCell className="text-textSecondary">{l.veiculoComprador}</TableCell>
                <TableCell className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono-num">{l.iofValorFmt}</span>
                  <Badge
                    variant={l.iofIncide === 'sim' ? 'warning' : l.iofIncide === 'nao' ? 'success' : 'neutral'}
                    size="sm"
                    title={l.iofMotivo}
                  >
                    {l.iofIncide === 'sim' ? 'incide' : l.iofIncide === 'nao' ? 'não incide' : 'indeterminado'}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <div className="text-[11.5px] text-textTertiary leading-relaxed mt-3">{data.avisoRegimeTributario}</div>

      <div className="mt-6">
        <SelfServiceAgentCard
          agentId="fiscal"
          title="Pergunte ao Agente Fiscal"
          placeholder="Ex: por que essa operação teve IOF e a outra não? Quanto de deságio eu paguei esse ano?"
        />
      </div>
    </div>
  );
}
