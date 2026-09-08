import { db } from '../db/index.js';
import { getPlatformSetting } from '../db/platformSettings.js';
import { VEICULO_LABEL } from '../data/seed.js';
import { fmtBRL, parseFlexibleDate } from './format.js';

// A camada fiscal do CEDENTE — o lado da mesa que não existia.
//
// O que já havia olhava o investidor (lib/incomeTaxStatement.ts — informe de rendimentos,
// tabela regressiva do IR) e a plataforma (lib/darfGenerator.ts — DARF agregado). A empresa
// que antecipa recebível não tinha nada: nem o deságio somado como despesa financeira, nem o
// IOF, que é onde o veículo do comprador passou a importar.
//
// IOF: a cessão de crédito a factoring e a instituição financeira é operação de crédito e
// sofre IOF/Crédito (Decreto 6.306/2007); a aquisição de direitos creditórios por FIDC não é
// operação de crédito e não sofre. Antes da migração 0070 a plataforma não sabia o veículo do
// adquirente, então essa distinção não era computável — agora é, por operação.
//
// Mesma disciplina de lib/darfGenerator.ts: computa de verdade sobre dado real e diz
// exatamente o que é. As alíquotas abaixo são as de referência do IOF/Crédito para pessoa
// jurídica e ficam sobrescrevíveis por platform_settings porque legislação tributária muda —
// e um número desatualizado apresentado como certo é pior que um número apresentado como
// estimativa. Nada aqui apura, retém ou recolhe imposto.

export const IOF_FONTE_LEGAL = 'Decreto 6.306/2007 (IOF/Crédito)';
export const IOF_AVISO =
  'Estimativa calculada sobre as operações reais desta conta com as alíquotas de referência do IOF/Crédito para pessoa jurídica. ' +
  'Alíquotas de tributos mudam por decreto: confirme as vigentes com seu contador antes de usar este número para apuração. ' +
  'A Lastro não apura, não retém e não recolhe IOF — este relatório é insumo para a sua contabilidade.';

const DEFAULT_IOF_DIARIA_PCT = 0.0041;
const DEFAULT_IOF_ADICIONAL_PCT = 0.38;
const IOF_DIAS_MAX = 365;

function aliquotas(): { diariaPct: number; adicionalPct: number; origem: 'padrao' | 'configurada' } {
  const diaria = Number(getPlatformSetting('iof_aliquota_diaria_pct'));
  const adicional = Number(getPlatformSetting('iof_aliquota_adicional_pct'));
  const configurada = Number.isFinite(diaria) && diaria > 0 && Number.isFinite(adicional) && adicional >= 0;
  return {
    diariaPct: configurada ? diaria : DEFAULT_IOF_DIARIA_PCT,
    adicionalPct: configurada ? adicional : DEFAULT_IOF_ADICIONAL_PCT,
    origem: configurada ? 'configurada' : 'padrao',
  };
}

// Quem adquire define a natureza da operação, e a natureza define a incidência.
const INCIDE_IOF: Record<string, boolean> = { factoring: true, banco: true, fidc: false, fundo: false };

export type IncidenciaIof = 'sim' | 'nao' | 'indeterminado';

export interface LinhaFiscalCedente {
  duplicataId: string;
  sacado: string;
  dataNegociacao: string;
  valorFace: number;
  valorFaceFmt: string;
  precoRecebido: number;
  precoRecebidoFmt: string;
  despesaFinanceira: number;
  despesaFinanceiraFmt: string;
  taxaPlataforma: number;
  taxaPlataformaFmt: string;
  veiculoComprador: string;
  iofIncide: IncidenciaIof;
  iofValor: number | null;
  iofValorFmt: string;
  iofMotivo: string;
}

export interface ResumoFiscalCedente {
  ano: number;
  operacoes: number;
  valorFaceTotalFmt: string;
  precoRecebidoTotalFmt: string;
  despesaFinanceiraTotal: number;
  despesaFinanceiraTotalFmt: string;
  taxaPlataformaTotalFmt: string;
  iofTotal: number;
  iofTotalFmt: string;
  iofIndeterminadas: number;
  linhas: LinhaFiscalCedente[];
  aliquotas: { diariaPct: number; adicionalPct: number; origem: string; fonte: string };
  aviso: string;
  avisoRegimeTributario: string;
}

interface OperacaoRow {
  duplicata_id: string;
  sacado_nome: string;
  created_at: string;
  vencimento: string;
  face: number;
  retorno: number;
  veiculo: string;
}

export function buildResumoFiscalCedente(cedenteId: number, ano: number): ResumoFiscalCedente {
  // Uma operação fiscal do cedente é uma duplicata DELE que foi de fato negociada — a compra
  // é o fato gerador, não a emissão nem o leilão aberto.
  const rows = db
    .prepare(
      `SELECT p.duplicata_id, d.sacado_nome, p.created_at, d.vencimento, p.valor as face, p.retorno, u.veiculo
         FROM purchases p
         JOIN duplicatas d ON d.id = p.duplicata_id
         JOIN users u ON u.id = p.investor_id
        WHERE d.cedente_id = ? AND d.sandbox = 0 AND strftime('%Y', p.created_at) = ?
        ORDER BY p.created_at DESC`
    )
    .all(cedenteId, String(ano)) as OperacaoRow[];

  const taxaPorDuplicata = new Map<string, number>();
  for (const row of db
    .prepare("SELECT duplicata_id, SUM(fee_valor) as fee FROM platform_fee_events WHERE origem = 'compra' GROUP BY duplicata_id")
    .all() as { duplicata_id: string; fee: number }[]) {
    taxaPorDuplicata.set(row.duplicata_id, row.fee);
  }

  const { diariaPct, adicionalPct, origem } = aliquotas();
  const linhas: LinhaFiscalCedente[] = [];
  let iofTotal = 0;
  let indeterminadas = 0;

  for (const row of rows) {
    const precoRecebido = row.face - row.retorno;
    const veiculoLabel = VEICULO_LABEL[row.veiculo] ?? 'Não informado';
    const incideConhecido = INCIDE_IOF[row.veiculo];

    let iofIncide: IncidenciaIof;
    let iofValor: number | null;
    let iofMotivo: string;

    if (incideConhecido === undefined) {
      // Não afirmar "sem IOF" para quem não se classificou: seria dizer o que não se sabe.
      iofIncide = 'indeterminado';
      iofValor = null;
      iofMotivo = 'O adquirente não informou sob qual veículo comprou — a incidência não pode ser determinada.';
      indeterminadas++;
    } else if (incideConhecido) {
      const dias = Math.min(
        IOF_DIAS_MAX,
        Math.max(0, Math.round((parseFlexibleDate(row.vencimento).getTime() - new Date(row.created_at + 'Z').getTime()) / 86_400_000))
      );
      iofValor = precoRecebido * ((diariaPct * dias) / 100 + adicionalPct / 100);
      iofIncide = 'sim';
      iofMotivo = `Cessão a ${veiculoLabel} é operação de crédito: IOF sobre ${fmtBRL(precoRecebido)} por ${dias} dia(s).`;
      iofTotal += iofValor;
    } else {
      iofIncide = 'nao';
      iofValor = 0;
      // Sem toLowerCase: 'FIDC' é sigla, e minusculizar o rótulo vira "por fidc".
      iofMotivo = `Aquisição de direitos creditórios por ${veiculoLabel} não é operação de crédito — sem incidência de IOF.`;
    }

    linhas.push({
      duplicataId: row.duplicata_id,
      sacado: row.sacado_nome,
      dataNegociacao: row.created_at.slice(0, 10),
      valorFace: row.face,
      valorFaceFmt: fmtBRL(row.face),
      precoRecebido,
      precoRecebidoFmt: fmtBRL(precoRecebido),
      despesaFinanceira: row.retorno,
      despesaFinanceiraFmt: fmtBRL(row.retorno),
      taxaPlataforma: taxaPorDuplicata.get(row.duplicata_id) ?? 0,
      taxaPlataformaFmt: fmtBRL(taxaPorDuplicata.get(row.duplicata_id) ?? 0),
      veiculoComprador: veiculoLabel,
      iofIncide,
      iofValor,
      iofValorFmt: iofValor === null ? '—' : fmtBRL(iofValor),
      iofMotivo,
    });
  }

  const soma = (f: (l: LinhaFiscalCedente) => number) => linhas.reduce((s, l) => s + f(l), 0);
  const despesaFinanceiraTotal = soma((l) => l.despesaFinanceira);

  return {
    ano,
    operacoes: linhas.length,
    valorFaceTotalFmt: fmtBRL(soma((l) => l.valorFace)),
    precoRecebidoTotalFmt: fmtBRL(soma((l) => l.precoRecebido)),
    despesaFinanceiraTotal,
    despesaFinanceiraTotalFmt: fmtBRL(despesaFinanceiraTotal),
    taxaPlataformaTotalFmt: fmtBRL(soma((l) => l.taxaPlataforma)),
    iofTotal,
    iofTotalFmt: fmtBRL(iofTotal),
    iofIndeterminadas: indeterminadas,
    linhas,
    aliquotas: { diariaPct, adicionalPct, origem, fonte: IOF_FONTE_LEGAL },
    aviso: IOF_AVISO,
    // PIS/COFINS e a apuração de IRPJ/CSLL dependem do regime tributário da empresa, que a
    // plataforma não conhece — e supor lucro real ou presumido mudaria o número. Fica dito,
    // não calculado.
    avisoRegimeTributario:
      'O tratamento do deságio como despesa financeira dedutível e a incidência de PIS/COFINS sobre receita financeira dependem do regime tributário da sua empresa (lucro real ou presumido), que a Lastro não conhece. Os valores acima são os fatos da operação, não uma apuração.',
  };
}
