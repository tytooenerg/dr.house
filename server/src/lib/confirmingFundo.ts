import crypto from 'node:crypto';
import {
  addFundoLedgerEntry,
  addFundoContribution,
  addFundoQuotaMovement,
  getFundoBalance,
  getFundoInvestorPosition,
  getFundoInvestorQuotas,
  getFundoTotalQuotas,
  listOpenFundoContributionsByInvestor,
  listRecentFundoLedger,
  markFundoRedeemed,
} from '../db/confirmingFundo.js';
import { addLedgerEntry } from '../db/misc.js';
import { createUser, getUserByEmail, approveKyb } from '../db/users.js';
import { sumOutstandingPurchasesByInvestor } from '../db/duplicatas.js';
import { hashPassword } from '../auth/password.js';
import { fmtBRL } from './format.js';

// Conta de sistema, nunca logável, que detém as posições que o fundo comprou de fato
// (purchases.investor_id é uma FK real pra users, então o fundo precisa de UM titular
// pra que o resto do app — carteira, liquidação, maturidade — trate essas posições como
// qualquer outra compra). Criada uma vez, de forma preguiçosa (na primeira compra
// financiada), no mesmo padrão de conta-nunca-logável já usado pra contas só-Google
// (routes/auth.ts: senha aleatória, bcrypt-hasheada do jeito normal, nunca revelada —
// verifyPassword nunca vai bater com ela).
const FUNDO_SISTEMA_EMAIL = 'fundo-confirming@lastro.internal';

export async function getOrCreateFundoSistemaUserId(): Promise<number> {
  const existing = getUserByEmail(FUNDO_SISTEMA_EMAIL);
  if (existing) return existing.id;
  const randomPasswordHash = await hashPassword(crypto.randomBytes(24).toString('hex'));
  const user = createUser({
    email: FUNDO_SISTEMA_EMAIL,
    passwordHash: randomPasswordHash,
    nome: 'Fundo de Fomento do Confirming',
    companyName: 'Fundo de Fomento do Confirming (conta de sistema)',
    role: 'investidor',
  });
  approveKyb(user.id);
  return user.id;
}

// Versão síncrona pra chamadores que só precisam checar "esse credor É o fundo?" (ex.:
// lib/aceiteCore.ts's reportPayment) sem pagar o custo de criar a conta de sistema se ela
// nunca tiver financiado nada ainda — ao contrário de getOrCreateFundoSistemaUserId, nunca
// cria a conta, só a acha se ela já existir.
export function getFundoSistemaUserIdIfExists(): number | null {
  return getUserByEmail(FUNDO_SISTEMA_EMAIL)?.id ?? null;
}

// Fundo de Fomento do Programa Confirming — abre o financiamento instantâneo do Programa
// Confirming (feature seguinte) pra funding real de investidor, na mesma disciplina da
// linha de crédito rotativa (lib/creditLineFund.ts): sem aporte real no pool, não há
// como financiar nada. Deliberadamente um pool SEPARADO do fundo da linha de crédito —
// perfis de risco/rendimento diferentes não devem se misturar.
//
// Mesmo mecanismo de cota/NAV que o fundo da linha de crédito (ver comentário lá pra
// explicação completa): cada aporte compra cotas no preço atual; cada resgate vende de
// volta no preço atual; rendimento devolvido nunca cria cota nova, só aumenta o NAV — o
// preço da cota sobe pra quem já tinha cota naquele momento, distribuindo rendimento
// proporcional a quanto/quanto tempo cada investidor teve dinheiro no fundo de verdade.
const INITIAL_COTA_PRICE = 1;

// NAV = caixa real na ledger (getFundoBalance) + valor de face das posições que o fundo
// ainda detém e não foram pagas (sumOutstandingPurchasesByInvestor) — mesmo espírito de
// creditLineFund.ts's computeFundNav somando os saques em aberto da linha de crédito. Só
// caixa subestimaria o NAV real sempre que o fundo tiver financiado algo que ainda não
// voltou via lib/settlement.ts's settleAtMaturity (ver fundoRetornoDePagamento abaixo).
export function computeFundoNav(): number {
  const sistemaUserId = getFundoSistemaUserIdIfExists();
  const outstanding = sistemaUserId !== null ? sumOutstandingPurchasesByInvestor(sistemaUserId) : 0;
  return getFundoBalance() + outstanding;
}

export function getFundoCotaPrice(): number {
  const totalQuotas = getFundoTotalQuotas();
  if (totalQuotas <= 0) return INITIAL_COTA_PRICE;
  return computeFundoNav() / totalQuotas;
}

export function contribuirParaFundo(investorId: number, valor: number) {
  const cotaPrice = getFundoCotaPrice();
  const quotas = valor / cotaPrice;
  addFundoContribution(investorId, valor); // mantido pro "principal aportado" de referência — ver buildFundoOverview
  addFundoQuotaMovement(investorId, quotas, cotaPrice);
  addFundoLedgerEntry('aporte', valor, 'Aporte no fundo de fomento do Programa Confirming', { investorId });
  addLedgerEntry(investorId, new Date().toLocaleDateString('pt-BR'), 'Aporte no fundo de fomento do Programa Confirming', -valor);
}

export type ResgateFundoOutcome = { status: 200; body: { ok: true; valorFmt: string } } | { status: 400 | 409; body: { error: string; message: string } };

export function resgatarDoFundo(investorId: number, valor: number): ResgateFundoOutcome {
  if (valor <= 0) return { status: 400, body: { error: 'invalid_amount', message: 'Valor deve ser positivo.' } };
  const cotaPrice = getFundoCotaPrice();
  const equityValue = getFundoInvestorQuotas(investorId) * cotaPrice; // principal + rendimento acumulado, no preço de hoje
  const poolBalance = getFundoBalance(); // só o caixa — não dá pra entregar dinheiro que o pool não tem em mãos de verdade
  const available = Math.max(0, Math.min(equityValue, poolBalance));
  if (valor > available) {
    return {
      status: 409,
      body: {
        error: 'insufficient_available',
        message: `Disponível para resgate: ${fmtBRL(available)} (sua posição já inclui rendimento acumulado; limitado também pelo saldo livre do pool — parte do seu aporte pode estar financiando compras em aberto).`,
      },
    };
  }

  addFundoQuotaMovement(investorId, -(valor / cotaPrice), cotaPrice);

  let remaining = valor;
  for (const contribution of listOpenFundoContributionsByInvestor(investorId)) {
    if (remaining <= 0) break;
    const outstanding = contribution.valor_aportado - contribution.valor_resgatado;
    const take = Math.min(remaining, outstanding);
    markFundoRedeemed(contribution.id, take);
    remaining -= take;
  }

  addFundoLedgerEntry('resgate', -valor, 'Resgate do fundo de fomento do Programa Confirming', { investorId });
  addLedgerEntry(investorId, new Date().toLocaleDateString('pt-BR'), 'Resgate do fundo de fomento do Programa Confirming', valor);
  return { status: 200, body: { ok: true, valorFmt: fmtBRL(valor) } };
}

// Chamado por lib/confirmingCore.ts (feature seguinte) assim que uma duplicata for
// financiada automaticamente dentro de um Programa Confirming — registra de qual duplicata
// o dinheiro do pool saiu, mesmo papel de creditLineFund.ts's fundDraw.
export function fundoFinanciarCompra(duplicataId: string, valor: number) {
  addFundoLedgerEntry('compra_financiada', -valor, `Compra financiada — duplicata ${duplicataId}`, { duplicataId });
}

// Chamado por lib/aceiteCore.ts's reportPayment quando o sacado reporta o pagamento de uma
// duplicata financiada pelo fundo (só se o credor atual for a conta de sistema do fundo) —
// devolve o valor recebido ao pool, mesmo papel de creditLineFund.ts's returnFromRepayment.
export function fundoRetornoDePagamento(duplicataId: string, valor: number) {
  if (valor <= 0) return;
  addFundoLedgerEntry('retorno', valor, `Retorno de pagamento — duplicata ${duplicataId}`, { duplicataId });
}

export interface ConfirmingFundoOverview {
  balanceFmt: string;
  navFmt: string;
  cotaPriceFmt: string;
  yourPositionFmt: string | null;
  yourPrincipalAportadoFmt: string | null;
  yourAvailableToRedeemFmt: string | null;
  recentLedger: { tipo: string; valorFmt: string; descricao: string; quando: string }[];
}

export function buildFundoOverview(investorId: number | null): ConfirmingFundoOverview {
  const balance = getFundoBalance();
  const nav = computeFundoNav();
  const cotaPrice = getFundoCotaPrice();
  let yourPositionFmt: string | null = null;
  let yourPrincipalAportadoFmt: string | null = null;
  let yourAvailableToRedeemFmt: string | null = null;
  if (investorId != null) {
    const equityValue = getFundoInvestorQuotas(investorId) * cotaPrice;
    yourPositionFmt = fmtBRL(equityValue);
    yourPrincipalAportadoFmt = fmtBRL(getFundoInvestorPosition(investorId));
    yourAvailableToRedeemFmt = fmtBRL(Math.max(0, Math.min(equityValue, balance)));
  }
  return {
    balanceFmt: fmtBRL(balance),
    navFmt: fmtBRL(nav),
    cotaPriceFmt: 'R$ ' + cotaPrice.toFixed(4).replace('.', ','),
    yourPositionFmt,
    yourPrincipalAportadoFmt,
    yourAvailableToRedeemFmt,
    recentLedger: listRecentFundoLedger(20).map((l) => ({
      tipo: l.tipo,
      valorFmt: (l.valor >= 0 ? '+' : '') + fmtBRL(l.valor),
      descricao: l.descricao,
      quando: l.created_at,
    })),
  };
}
