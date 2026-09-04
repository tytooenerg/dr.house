import { getSacadoAccountByCompanyName } from '../db/users.js';
import type { RegistradoraKey } from './registradoras.js';
import { getMembro, getProgramaBySacado, setMembroUtilizado, setProgramaUtilizado } from '../db/confirming.js';
import { createPurchase, isPurchased, listMarketplace } from '../db/duplicatas.js';
import { getFundoBalance } from '../db/confirmingFundo.js';
import { fundoFinanciarCompra, getOrCreateFundoSistemaUserId } from './confirmingFundo.js';
import { settlePurchase } from './settlement.js';
import { informarNegociacao } from './registradoras.js';
import { computePurchasePrice } from './marketCompute.js';
import { fmtTaxaAm } from './confirmingCore.js';
import { recordAuditEvent } from '../db/audit.js';

// Achado corrigido (mudança de modelo de negócio): o financiamento automático do
// Programa Confirming costumava disparar na emissão, pulando o leilão inteiramente
// (lib/confirmingCore.ts's antiga tentarFinanciarViaPrograma) — a duplicata nunca
// passava por 'no_mercado', e o Fundo de Fomento da própria Lastro tinha um atalho que
// nenhum outro investidor tinha. A Lastro é infraestrutura neutra pro mercado de
// duplicata (o mesmo papel que a Stripe tem pra pagamentos) — não uma parte que se
// autobeneficia. Este arquivo substitui aquele mecanismo: o fundo só compra depois que a
// duplicata já está em leilão real (`dispararLeilao` → 'no_mercado', o que já exige
// aceite confirmado — ver routes/minhas.ts), competindo pelo mesmo caminho de compra que
// qualquer banco ou investidor usaria (createPurchase + settlePurchase, idêntico a
// routes/market.ts's POST /:id/buy), sem nenhum atalho.
//
// Preço: taxa DINÂMICA de mercado (computePurchasePrice(d), sem override) — a mesma
// fórmula que qualquer outro comprador pagaria pela mesma oferta. programa.taxa_am (a
// taxa negociada entre o sacado e a Lastro pro programa) deixa de fixar o preço e vira
// só um TETO: o fundo só tenta comprar se a taxa de mercado do momento estiver dentro do
// que foi negociado — nunca paga mais caro que isso, mas também nunca leva um desconto
// que outro investidor não teria.
//
// Mecanismo de disputa: como a plataforma não tem lance concorrente real (é sempre
// "primeiro que compra ganha" a um preço já calculado — não existe tabela de lances nem
// fechamento de leilão, ver lib/marketCompute.ts), o fundo participa via este job
// periódico varrendo o marketplace aberto — a mesma vantagem de velocidade que qualquer
// investidor Pro com Automação de Lances (routes/automation.ts) já tem hoje (poll a cada
// 4s). Sem vantagem estrutural: se um humano ou outro bot for mais rápido, ganha ele.
export interface FundoAutoBuyResultado {
  compradas: number;
}

export async function runFundoAutoBuyTick(): Promise<FundoAutoBuyResultado> {
  const fundoUserId = await getOrCreateFundoSistemaUserId();
  let compradas = 0;

  for (const d of listMarketplace()) {
    if (d.status !== 'no_mercado' || isPurchased(d.id)) continue;
    if (!d.cedente_id) continue; // ofertas de marketplace sem cedente cadastrado (dados de demo) não têm matrícula possível

    const sacadoAccount = getSacadoAccountByCompanyName(d.sacado_nome);
    if (!sacadoAccount) continue;

    const programa = getProgramaBySacado(sacadoAccount.id);
    if (!programa || programa.status !== 'ativo') continue;

    const membro = getMembro(programa.id, d.cedente_id);
    if (!membro || membro.status !== 'ativo') continue;

    if (programa.utilizado + d.valor > programa.limite) continue;
    if (membro.sublimite !== null && membro.utilizado + d.valor > membro.sublimite) continue;

    // Taxa de mercado real (sem override) — o fundo só entra se ela couber dentro do teto
    // negociado com o sacado; senão, deixa a oferta pra qualquer outro investidor.
    const { precoCompra, taxaAmPct } = computePurchasePrice(d);
    if (taxaAmPct > programa.taxa_am) continue;
    if (getFundoBalance() < precoCompra) continue;

    // Mesma sequência síncrona de routes/market.ts's POST /:id/buy — sem nenhum `await`
    // entre a última checagem (getFundoBalance) e a escrita, pra não abrir uma janela de
    // race dentro do event loop do Node (better-sqlite3 é síncrono).
    createPurchase(d.id, fundoUserId, d.valor, fmtTaxaAm(programa.taxa_am), Math.round(d.valor - precoCompra));
    settlePurchase({ duplicataId: d.id, sacadoNome: d.sacado_nome, investorId: fundoUserId, cedenteId: d.cedente_id, valor: d.valor, precoCompra });
    // Res. BCB nº 540/2025 — ver comentário de informarNegociacao (lib/registradoras.ts).
    void informarNegociacao({ registradoraKey: d.registradora as RegistradoraKey | null, duplicataId: d.id, evento: 'compra', valor: precoCompra });
    fundoFinanciarCompra(d.id, precoCompra);
    setProgramaUtilizado(programa.id, programa.utilizado + d.valor);
    setMembroUtilizado(membro.id, membro.utilizado + d.valor);
    recordAuditEvent(null, 'Fundo Confirming', 'confirming.duplicata_financiada_via_leilao', { duplicataId: d.id });
    compradas++;
  }

  return { compradas };
}

// Só é chamado de src/index.ts (processo real do server) — nunca de app.ts, mesmo padrão
// de lib/aceiteTacito.ts's startAceiteTacitoJob — pra testes nunca subirem um timer de
// fundo; testes chamam runFundoAutoBuyTick() direto.
export function startFundoAutoBuyJob(intervalMs = 30_000): NodeJS.Timeout {
  void runFundoAutoBuyTick();
  return setInterval(runFundoAutoBuyTick, intervalMs);
}
