import type { DuplicataRow, Plan } from '../db/types.js';
import { listByCedente } from '../db/duplicatas.js';
import { aceiteConfirmado } from './aceiteCore.js';
import { buildCashflowForecast } from './cashflowForecast.js';
import { computePurchasePrice } from './marketCompute.js';
import { listInsuranceQuotes } from './insuranceQuotes.js';
import { fmtBRL, parseFlexibleDate } from './format.js';

// O Motor de Decisão do CFO: sai da projeção de caixa e chega numa recomendação executável —
// quais duplicatas antecipar pra cobrir o déficit, com ou sem seguro, e quanto custa cada
// caminho. Todas as peças já existiam soltas (forecast, elegibilidade, preço, cotação de
// seguro, leilão); o que não existia era alguém compondo as quatro num número só.
//
// Sem LLM de propósito: isto é aritmética sobre dado real, então é determinístico, testável e
// não depende de chave de API pra funcionar. O agente de IA (lib/agents/cfoAntecipacao.ts)
// continua servindo pra EXPLICAR a recomendação; a decisão não sai dele.

export interface CfoPlanoItem {
  duplicataId: string;
  sacado: string;
  vencimento: string;
  valorFmt: string;
  precoCompra: number;
  precoCompraFmt: string;
  custo: number;
  custoFmt: string;
  taxaAmFmt: string;
  seguradora: string | null;
  premio: number;
  premioFmt: string;
}

export interface CfoPlano {
  comSeguro: boolean;
  itens: CfoPlanoItem[];
  liquidoLevantado: number;
  liquidoLevantadoFmt: string;
  custoTotal: number;
  custoTotalFmt: string;
  // Custo sobre o dinheiro que entra no caixa — é assim que o empresário compara com uma
  // linha de crédito, não sobre o valor de face.
  custoPct: number;
  custoPctFmt: string;
  cobreDeficit: boolean;
  reservaSugeridaAm: number;
  reservaSugeridaFmt: string;
}

export interface CfoRecommendation {
  temDeficit: boolean;
  deficit: { emDias: number; valor: number; valorFmt: string } | null;
  elegiveis: { quantidade: number; valorFmt: string };
  plano: CfoPlano | null;
  planoComSeguro: CfoPlano | null;
  // Quanto o mesmo plano custaria se o cedente esperasse até a data do déficit: o deságio é
  // proporcional ao prazo que falta, então adiar é sempre mais barato — o que a recomendação
  // precisa dizer, pra "antecipar agora" ser uma escolha e não um pressuposto.
  esperar: { custoTotalFmt: string; economiaFmt: string } | null;
  mensagem: string;
  motivo: string | null;
}

function pct(n: number): string {
  return n.toFixed(2).replace('.', ',') + '%';
}

/**
 * Candidatos: exatamente o que `POST /minhas/:id/leilao` (routes/minhas.ts) aceitaria hoje —
 * lastro 100%, status 'aprovada' e aceite confirmado. Recomendar o que a própria plataforma
 * recusaria seria oferecer uma opção que não existe.
 *
 * E só duplicata que vence DEPOIS do déficit: uma que vence antes já está contada no saldo
 * projetado daquela data, então antecipá-la não põe dinheiro novo lá — só adianta (com
 * deságio) o que já ia entrar.
 */
export function candidatasParaAntecipacao(cedenteId: number, deficitEmDias: number | null): DuplicataRow[] {
  const limite = deficitEmDias === null ? null : Date.now() + deficitEmDias * 86_400_000;
  return listByCedente(cedenteId).filter((d) => {
    if (d.lastro_pct !== 100 || d.status !== 'aprovada') return false;
    if (!aceiteConfirmado(d.id)) return false;
    if (limite !== null && parseFlexibleDate(d.vencimento).getTime() <= limite) return false;
    return true;
  });
}

function montarPlano(candidatas: DuplicataRow[], falta: number, comSeguro: boolean, nowMs = Date.now()): CfoPlano | null {
  // Ordena por CUSTO POR REAL LEVANTADO, não por risco: pra cobrir um déficit gastando menos,
  // prazo curto ganha de score alto. É o que o agente cfoAntecipacao (que ordena por risco)
  // não responde.
  const avaliadas = candidatas
    .map((d) => {
      const { precoCompra, taxaAmPct } = computePurchasePrice(d, undefined, nowMs);
      const cotacao = comSeguro ? listInsuranceQuotes(d)[0] ?? null : null;
      const premio = cotacao ? (d.valor * cotacao.premioPct) / 100 : 0;
      const custo = d.valor - precoCompra + premio;
      return { d, precoCompra, taxaAmPct, cotacao, premio, custo, custoPorReal: precoCompra > 0 ? custo / precoCompra : Infinity };
    })
    .sort((a, b) => a.custoPorReal - b.custoPorReal);

  const itens: CfoPlanoItem[] = [];
  let liquido = 0;
  let custoTotal = 0;
  let taxaMax = 0;
  for (const c of avaliadas) {
    if (liquido >= falta) break;
    itens.push({
      duplicataId: c.d.id,
      sacado: c.d.sacado_nome,
      vencimento: c.d.vencimento,
      valorFmt: fmtBRL(c.d.valor),
      precoCompra: c.precoCompra,
      precoCompraFmt: fmtBRL(c.precoCompra),
      custo: c.custo,
      custoFmt: fmtBRL(c.custo),
      taxaAmFmt: pct(c.taxaAmPct),
      seguradora: c.cotacao?.name ?? null,
      premio: c.premio,
      premioFmt: fmtBRL(c.premio),
    });
    liquido += c.precoCompra;
    custoTotal += c.custo;
    taxaMax = Math.max(taxaMax, c.taxaAmPct);
  }
  if (itens.length === 0) return null;

  return {
    comSeguro,
    itens,
    liquidoLevantado: liquido,
    liquidoLevantadoFmt: fmtBRL(liquido),
    custoTotal,
    custoTotalFmt: fmtBRL(custoTotal),
    custoPct: liquido > 0 ? (custoTotal / liquido) * 100 : 0,
    custoPctFmt: pct(liquido > 0 ? (custoTotal / liquido) * 100 : 0),
    cobreDeficit: liquido >= falta,
    // A reserva sugerida é a pior taxa que o plano já assume: aceitar acima disso seria
    // aceitar um custo que a recomendação não mostrou.
    reservaSugeridaAm: taxaMax,
    reservaSugeridaFmt: pct(taxaMax),
  };
}

export async function buildCfoRecommendation(cedenteId: number, plan: Plan, companyCnpj: string): Promise<CfoRecommendation> {
  const forecast = await buildCashflowForecast(cedenteId, plan, companyCnpj);
  const base = forecast.scenarios.find((s) => s.scenario === 'base');
  const ponto = base?.points.find((p) => p.deficit) ?? null;

  if (!ponto) {
    return {
      temDeficit: false,
      deficit: null,
      elegiveis: { quantidade: 0, valorFmt: fmtBRL(0) },
      plano: null,
      planoComSeguro: null,
      esperar: null,
      mensagem: 'Nenhum déficit de caixa projetado no cenário base. Não há motivo para antecipar recebíveis agora.',
      motivo: 'sem_deficit',
    };
  }

  const falta = Math.abs(ponto.saldoProjetado);
  const candidatas = candidatasParaAntecipacao(cedenteId, ponto.days);
  const elegiveis = {
    quantidade: candidatas.length,
    valorFmt: fmtBRL(candidatas.reduce((sum, d) => sum + d.valor, 0)),
  };

  if (candidatas.length === 0) {
    return {
      temDeficit: true,
      deficit: { emDias: ponto.days, valor: falta, valorFmt: fmtBRL(falta) },
      elegiveis,
      plano: null,
      planoComSeguro: null,
      esperar: null,
      mensagem: `Déficit projetado de ${fmtBRL(falta)} em até ${ponto.days} dias, mas nenhuma duplicata sua está elegível para antecipação hoje — é preciso lastro de 100% e aceite confirmado do sacado, e o vencimento precisa ser posterior ao déficit.`,
      motivo: 'sem_candidatas',
    };
  }

  const plano = montarPlano(candidatas, falta, false);
  const planoComSeguro = montarPlano(candidatas, falta, true);

  // Mesmo plano, precificado na data do déficit em vez de hoje.
  let esperar: CfoRecommendation['esperar'] = null;
  if (plano) {
    const naData = montarPlano(
      candidatas.filter((d) => plano.itens.some((i) => i.duplicataId === d.id)),
      falta,
      false,
      Date.now() + ponto.days * 86_400_000
    );
    if (naData) {
      esperar = {
        custoTotalFmt: fmtBRL(naData.custoTotal),
        economiaFmt: fmtBRL(Math.max(0, plano.custoTotal - naData.custoTotal)),
      };
    }
  }

  const cobre = plano?.cobreDeficit ?? false;
  const mensagem = plano
    ? `Sua empresa terá déficit projetado de ${fmtBRL(falta)} em até ${ponto.days} dias. Identifiquei ${elegiveis.valorFmt} em recebíveis elegíveis. ` +
      (cobre
        ? `Antecipando ${plano.itens.length} ${plano.itens.length === 1 ? 'duplicata' : 'duplicatas'} você levanta ${plano.liquidoLevantadoFmt} ao custo de ${plano.custoTotalFmt} (${plano.custoPctFmt} sobre o valor levantado).`
        : `Antecipando tudo o que está elegível você levanta ${plano.liquidoLevantadoFmt} — não cobre o déficit inteiro, mas reduz a diferença.`)
    : `Déficit projetado de ${fmtBRL(falta)} em até ${ponto.days} dias.`;

  return {
    temDeficit: true,
    deficit: { emDias: ponto.days, valor: falta, valorFmt: fmtBRL(falta) },
    elegiveis,
    plano,
    planoComSeguro,
    esperar,
    mensagem,
    motivo: null,
  };
}
