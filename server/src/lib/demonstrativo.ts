import type { computePurchasePrice } from './marketCompute.js';
import { pctLabel, splitPrimario, splitRevenda } from './settlement.js';
import { fmtBRLCentavos } from './format.js';

// "Quem paga quanto e quem recebe quanto" — a conta inteira de uma operação, em reais, do
// valor de face até o que cai no saldo de cada lado. O investidor via só uma taxa a.m., o
// cedente só o "melhor preço" e o secundário só o preço anunciado; ninguém via o caminho do
// dinheiro. Os números saem de splitPrimario/splitRevenda (lib/settlement.ts), as mesmas
// funções que movem o dinheiro de verdade — o que a tela mostra é o que a liquidação credita.

export interface LinhaDemonstrativo {
  rotulo: string;
  detalhe: string | null;
  valorFmt: string;
  // 'base' = ponto de partida, 'menos' = desconto, 'total' = subtotal, 'resultado' = o que alguém recebe
  tipo: 'base' | 'menos' | 'total' | 'resultado';
}

export interface Demonstrativo {
  linhas: LinhaDemonstrativo[];
  rodape: string;
  valorFace: number;
  compradorPaga: number;
  taxaPlataforma: number;
  vendedorRecebe: number;
  ganhoComprador: number;
}

const pct = (n: number, casas = 2) => (n * 100).toFixed(casas).replace('.', ',') + '%';

/**
 * Primário (leilão): o banco/fundo financia a empresa que emitiu a duplicata. Recebe o
 * resultado de computePurchasePrice (lib/marketCompute.ts) em vez de chamá-lo — marketCompute
 * monta a oferta com este demonstrativo, e importar de volta fecharia um ciclo de módulos.
 */
export function demonstrativoPrimario(valorFace: number, calc: ReturnType<typeof computePurchasePrice>): Demonstrativo {
  const { precoCompra, descontoValor, descontoPct, prazoDias, taxaAmPct: taxaAm } = calc;
  const d = { valor: valorFace };
  const { fee, net } = splitPrimario(d.valor, precoCompra);
  const taxaFmt = taxaAm.toFixed(2).replace('.', ',') + '%';
  const limitado = descontoPct < (taxaAm * (prazoDias / 30)) / 100 - 1e-12;
  const ganho = d.valor - precoCompra;
  return {
    linhas: [
      { rotulo: 'Valor da duplicata', detalhe: null, valorFmt: fmtBRLCentavos(d.valor), tipo: 'base' },
      {
        rotulo: 'Deságio do banco/fundo',
        detalhe: `${taxaFmt} a.m. × ${prazoDias} dias = ${pct(descontoPct)}${limitado ? ' (limite máximo de deságio)' : ''}`,
        valorFmt: `− ${fmtBRLCentavos(descontoValor)}`,
        tipo: 'menos',
      },
      { rotulo: 'Banco/fundo paga hoje', detalhe: null, valorFmt: fmtBRLCentavos(precoCompra), tipo: 'total' },
      { rotulo: 'Taxa da plataforma Lastro', detalhe: `${pctLabel(d.valor)} sobre o valor da duplicata`, valorFmt: `− ${fmtBRLCentavos(fee)}`, tipo: 'menos' },
      { rotulo: 'Empresa recebe', detalhe: null, valorFmt: fmtBRLCentavos(net), tipo: 'resultado' },
    ],
    rodape: `No vencimento o banco/fundo recebe ${fmtBRLCentavos(d.valor)} do sacado — ganho de ${fmtBRLCentavos(ganho)}${precoCompra > 0 ? ` (${pct(ganho / precoCompra)} no período)` : ''}.`,
    valorFace: d.valor,
    compradorPaga: precoCompra,
    taxaPlataforma: fee,
    vendedorRecebe: net,
    ganhoComprador: ganho,
  };
}

/** Secundário: um investidor vende a posição para outro antes do vencimento. */
export function demonstrativoRevenda(valorFace: number, preco: number, feeDiscountPct = 0): Demonstrativo {
  const { fee, net } = splitRevenda(preco, feeDiscountPct);
  const ganho = valorFace - preco;
  const desagioPct = valorFace > 0 ? (valorFace - preco) / valorFace : 0;
  return {
    linhas: [
      { rotulo: 'Valor da duplicata no vencimento', detalhe: null, valorFmt: fmtBRLCentavos(valorFace), tipo: 'base' },
      {
        rotulo: 'Comprador paga hoje',
        detalhe: desagioPct >= 0 ? `deságio de ${pct(desagioPct)} sobre o valor da duplicata` : `ágio de ${pct(-desagioPct)} sobre o valor da duplicata`,
        valorFmt: fmtBRLCentavos(preco),
        // Não é subtotal de nada acima: é o preço combinado, o ponto de partida da conta do vendedor.
        tipo: 'base',
      },
      {
        rotulo: 'Taxa da plataforma Lastro',
        detalhe: `${pctLabel(preco)} sobre o preço de venda${feeDiscountPct > 0 ? `, com ${pct(feeDiscountPct, 0)} de desconto institucional` : ''}`,
        valorFmt: `− ${fmtBRLCentavos(fee)}`,
        tipo: 'menos',
      },
      { rotulo: 'Vendedor recebe', detalhe: null, valorFmt: fmtBRLCentavos(net), tipo: 'resultado' },
    ],
    rodape:
      ganho >= 0
        ? `No vencimento o comprador recebe ${fmtBRLCentavos(valorFace)} do sacado — ganho de ${fmtBRLCentavos(ganho)}${preco > 0 ? ` (${pct(ganho / preco)} no período)` : ''}.`
        : `No vencimento o comprador recebe ${fmtBRLCentavos(valorFace)} do sacado — ${fmtBRLCentavos(-ganho)} a menos do que pagou.`,
    valorFace,
    compradorPaga: preco,
    taxaPlataforma: fee,
    vendedorRecebe: net,
    ganhoComprador: ganho,
  };
}
