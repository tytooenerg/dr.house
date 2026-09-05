import { getSacadoAccountByCompanyName } from '../db/users.js';
import type { RegistradoraKey } from './registradoras.js';
import { getMembro, getProgramaBySacado, setMembroUtilizado, setProgramaUtilizado } from '../db/confirming.js';
import { getDuplicata, isPurchased, listMarketplace } from '../db/duplicatas.js';
import { getUserById } from '../db/users.js';
import { placeAuctionBid } from './auctionCore.js';
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
  lances: number;
}

export async function runFundoAutoBuyTick(): Promise<FundoAutoBuyResultado> {
  const fundoUserId = await getOrCreateFundoSistemaUserId();
  let lances = 0;

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

    // O fundo DÁ LANCE como qualquer investidor, na taxa de mercado (que é a reserva do
    // leilão) — nunca em programa.taxa_am, que é TETO e não preço: lançar no teto seria um
    // deságio pior que a reserva e o próprio leilão recusaria (409 above_reserve). Quem
    // leva é decidido no fechamento — o fundo não tem, e não deve ter, atalho nenhum. A
    // contabilidade do fundo (débito no pool + consumo de limite) só acontece se ele
    // VENCER: ver settleFundoWin, chamado por lib/auctionClose.ts.
    const fundoUser = getUserById(fundoUserId);
    if (!fundoUser) continue;
    const outcome = placeAuctionBid(fundoUser, d.id, taxaAmPct);
    if (outcome.status !== 200) continue;
    recordAuditEvent(null, 'Fundo Confirming', 'confirming.lance_no_leilao', { duplicataId: d.id, taxaAm: taxaAmPct });
    lances++;
  }

  return { lances };
}

// Só é chamado de src/index.ts (processo real do server) — nunca de app.ts, mesmo padrão
// de lib/aceiteTacito.ts's startAceiteTacitoJob — pra testes nunca subirem um timer de
// fundo; testes chamam runFundoAutoBuyTick() direto.
export function startFundoAutoBuyJob(intervalMs = 30_000): NodeJS.Timeout {
  void runFundoAutoBuyTick();
  return setInterval(runFundoAutoBuyTick, intervalMs);
}


// Chamada por lib/auctionClose.ts quando o vencedor do leilão é a conta de sistema do
// Fundo de Fomento: só aí o dinheiro do pool sai e o limite do programa é consumido.
// Antes isso acontecia junto da compra instantânea; com leilão real, propor um lance não
// pode debitar nada — só vencer pode.
export function settleFundoWin(duplicataId: string, preco: number) {
  const d = getDuplicata(duplicataId);
  if (!d || !d.cedente_id) return;
  fundoFinanciarCompra(duplicataId, preco);
  const sacadoAccount = getSacadoAccountByCompanyName(d.sacado_nome);
  if (!sacadoAccount) return;
  const programa = getProgramaBySacado(sacadoAccount.id);
  if (!programa) return;
  const membro = getMembro(programa.id, d.cedente_id);
  setProgramaUtilizado(programa.id, programa.utilizado + d.valor);
  if (membro) setMembroUtilizado(membro.id, membro.utilizado + d.valor);
  recordAuditEvent(null, 'Fundo Confirming', 'confirming.duplicata_financiada_via_leilao', { duplicataId, preco });
}
