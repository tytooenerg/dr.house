import {
  countLeiloesEncerradosPorMes,
  countSinistrosAbertos,
  listCarteiraEmAberto,
  listCompradoresComLancePorMes,
  listLancesVencedoresDesde,
  listOperacoesDesde,
  sumReceitaPorMes,
} from '../db/businessMetrics.js';
import { fmtBRL, parseFlexibleDate, toIsoUtc } from './format.js';

// Os indicadores que o plano de ação manda acompanhar todo mês, calculados só com o que a
// plataforma de fato registra. Os que dependem de dado de fora (taxa que o banco ofereceu
// ao cedente, caixa da empresa, gasto comercial) vão em NAO_MEDIDOS em vez de virar estimativa.

const MESES_PT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const DIA_MS = 24 * 3600 * 1000;

export const NAO_MEDIDOS = [
  'Deságio comparado à taxa do banco do cedente — a plataforma não recebe a taxa que o banco ofereceu a ele.',
  'Caixa disponível da Lastro (meses de operação) — vem da contabilidade, não da plataforma.',
  'Custo para conquistar um cedente — depende do gasto de marketing e vendas, registrado fora da plataforma.',
];

export interface IndicadoresMes {
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

export interface IndicadoresNegocio {
  meses: IndicadoresMes[];
  carteira: {
    emDiaValor: number;
    emDiaValorFmt: string;
    vencidoValor: number;
    vencidoValorFmt: string;
    pctVencido: number | null;
    sinistrosAbertos: number;
  };
  naoMedidos: string[];
}

// Meses em UTC, como o banco grava — os primeiros minutos de um mês em Brasília (UTC-3)
// ainda caem no mês anterior, diferença irrelevante para um painel mensal.
function chavesDosMeses(now: Date, n: number): string[] {
  const chaves: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    chaves.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return chaves;
}

function rotulo(mes: string): string {
  return `${MESES_PT[Number(mes.slice(5, 7)) - 1]}/${mes.slice(0, 4)}`;
}

function mediaPonderada(itens: { valor: number; peso: number }[]): number | null {
  const pesoTotal = itens.reduce((s, i) => s + i.peso, 0);
  return pesoTotal > 0 ? itens.reduce((s, i) => s + i.valor * i.peso, 0) / pesoTotal : null;
}

export function computeIndicadoresNegocio(now = new Date(), nMeses = 6): IndicadoresNegocio {
  const chaves = chavesDosMeses(now, nMeses);
  const desde = `${chaves[0]}-01`;

  const operacoes = listOperacoesDesde(desde);
  const compradores = listCompradoresComLancePorMes(desde);
  const leiloes = countLeiloesEncerradosPorMes(desde);
  const vencedores = listLancesVencedoresDesde(desde);
  const receitas = sumReceitaPorMes(desde);

  const meses = chaves.map((mes): IndicadoresMes => {
    const ops = operacoes.filter((o) => o.primeira_compra.slice(0, 7) === mes);
    const volume = ops.reduce((s, o) => s + o.valor, 0);
    const adjudicados = Number(leiloes.find((l) => l.mes === mes && l.action === 'leilao.adjudicado')?.n ?? 0);
    const semLance = Number(leiloes.find((l) => l.mes === mes && l.action === 'leilao.encerrado_sem_lance')?.n ?? 0);
    const encerrados = adjudicados + semLance;
    const receita = Number(receitas.find((r) => r.mes === mes)?.receita ?? 0);

    const prazos = ops
      .map((o) => ({
        valor: (parseFlexibleDate(o.vencimento).getTime() - new Date(toIsoUtc(o.primeira_compra)).getTime()) / DIA_MS,
        peso: o.valor,
      }))
      .filter((p) => Number.isFinite(p.valor) && p.valor > 0);
    const prazoMedio = mediaPonderada(prazos);
    const desagioMedio = mediaPonderada(
      vencedores.filter((v) => v.leilao_fechado_em.slice(0, 7) === mes).map((v) => ({ valor: v.taxa_am, peso: v.valor }))
    );

    return {
      mes,
      mesLabel: rotulo(mes),
      volume,
      volumeFmt: fmtBRL(volume),
      operacoes: ops.length,
      cedentesAtivos: new Set(ops.map((o) => o.cedente_id).filter((id) => id !== null)).size,
      compradoresAtivos: compradores.filter((c) => c.mes === mes).length,
      leiloesEncerrados: encerrados,
      leiloesComLance: adjudicados,
      pctLeiloesComLance: encerrados > 0 ? Math.round((adjudicados / encerrados) * 1000) / 10 : null,
      desagioMedioAm: desagioMedio === null ? null : Math.round(desagioMedio * 100) / 100,
      prazoMedioDias: prazoMedio === null ? null : Math.round(prazoMedio),
      receita,
      receitaFmt: fmtBRL(receita),
    };
  });

  const hoje = now.getTime();
  let emDia = 0;
  let vencido = 0;
  for (const d of listCarteiraEmAberto()) {
    if (parseFlexibleDate(d.vencimento).getTime() + DIA_MS <= hoje) vencido += d.valor;
    else emDia += d.valor;
  }

  return {
    meses,
    carteira: {
      emDiaValor: emDia,
      emDiaValorFmt: fmtBRL(emDia),
      vencidoValor: vencido,
      vencidoValorFmt: fmtBRL(vencido),
      pctVencido: emDia + vencido > 0 ? Math.round((vencido / (emDia + vencido)) * 1000) / 10 : null,
      sinistrosAbertos: Number(countSinistrosAbertos()),
    },
    naoMedidos: NAO_MEDIDOS,
  };
}
