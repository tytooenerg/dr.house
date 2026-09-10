import { Card } from '../../../components/ui/Card';
import { ErrorState } from '../../../components/ui/ErrorState';
import { PageSkeleton } from '../../../components/ui/Skeleton';
import { PALETTE } from '../../../lib/palette';
import { useApi } from '../../../lib/useApi';

// "Esta instância está apta a mover dinheiro de verdade?"
//
// A resposta sempre existiu — espalhada em dezenove módulos e escrita no log de subida do
// servidor. Log de boot não serve para quem opera: quando o admin precisa saber se o depósito
// que um cliente acabou de fazer é real, o servidor está no ar há semanas e aquelas linhas já
// rolaram para fora de qualquer terminal.

interface Item {
  chave: string;
  nome: string;
  real: boolean;
  envs: string[];
  semEle: string;
}

interface Prontidao {
  modo: 'producao' | 'demonstracao';
  podeMoverDinheiro: boolean;
  dinheiro: Item[];
  integracoes: Item[];
  bloqueados: string[];
}

function Linha({ item, critico }: { item: Item; critico: boolean }) {
  const cor = item.real ? PALETTE.green : critico ? PALETTE.red : PALETTE.amber;
  const fundo = item.real ? PALETTE.greenBg : critico ? PALETTE.redBg : PALETTE.amberBg;
  return (
    <div className="flex items-start justify-between gap-3 py-2.5 border-b border-hairline last:border-b-0">
      <div className="min-w-0">
        <div className="font-bold text-[13px]">{item.nome}</div>
        {!item.real && (
          <>
            <div className="text-textSecondary text-[12px] mt-0.5">{item.semEle}</div>
            <div className="text-textTertiary text-[11.5px] font-mono-num mt-0.5 break-all">{item.envs.join(' · ')}</div>
          </>
        )}
      </div>
      <span className="text-[11.5px] font-bold px-2 py-1 rounded-md whitespace-nowrap" style={{ background: fundo, color: cor }}>
        {item.real ? 'real' : 'simulado'}
      </span>
    </div>
  );
}

export function PreflightPanel() {
  const { data, error, reload } = useApi<Prontidao>('/admin/preflight', { fallbackMessage: 'Falha ao carregar a prontidão da instância.' });

  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <PageSkeleton />;

  const producao = data.modo === 'producao';
  const bloqueado = data.bloqueados.length > 0;

  return (
    <Card className="mb-6">
      <div className="flex items-baseline justify-between gap-3 mb-1 flex-wrap">
        <div className="font-bold text-[15px]">Prontidão para produção</div>
        <span
          className="text-[11.5px] font-bold px-2.5 py-1 rounded-md"
          style={{
            background: producao ? (bloqueado ? PALETTE.redBg : PALETTE.greenBg) : PALETTE.amberBg,
            color: producao ? (bloqueado ? PALETTE.red : PALETTE.green) : PALETTE.amber,
          }}
        >
          {producao ? 'Produção' : 'Demonstração'}
        </span>
      </div>

      {producao && bloqueado && (
        <div className="text-[12.5px] rounded-md p-3 mb-3" style={{ background: PALETTE.redBg, color: PALETTE.red }}>
          <b>Depósito e saque estão bloqueados</b> em {data.bloqueados.join(', ')}. Esta instância está em produção com trilho de dinheiro
          simulado, então a plataforma <b>recusa</b> a operação em vez de criar saldo que não existe. Configure um PSP real para liberar.
        </div>
      )}
      {!producao && (
        <div className="text-textSecondary text-[12.5px] mb-3">
          Instância de demonstração (<span className="font-mono-num">NODE_ENV≠production</span> ou{' '}
          <span className="font-mono-num">SEED_DEMO_DATA=true</span>): dinheiro simulado é o comportamento desejado e nada está bloqueado.
        </div>
      )}
      {producao && !bloqueado && (
        <div className="text-textSecondary text-[12.5px] mb-3">
          Todos os trilhos de dinheiro estão apontando para PSPs reais. Isso não substitui o contrato com registradora autorizada nem a
          autorização regulatória para manter saldo de terceiros — ver <span className="font-mono-num">DEPLOY.md §9</span>.
        </div>
      )}

      <div className="font-bold text-[12px] uppercase text-textSecondary mt-4 mb-1">Trilhos de dinheiro</div>
      {data.dinheiro.map((t) => (
        <Linha key={t.chave} item={t} critico={producao} />
      ))}

      <div className="font-bold text-[12px] uppercase text-textSecondary mt-5 mb-1">Integrações</div>
      {data.integracoes.map((i) => (
        <Linha key={i.chave} item={i} critico={false} />
      ))}
    </Card>
  );
}
