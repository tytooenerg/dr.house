import { db } from './index.js';
import type { Role } from './types.js';
import { createUser, approveKyb, updateSubscription, setVeiculo, getUserByEmail } from './users.js';
import { createDuplicata, dispararLeilao, setInsurer } from './duplicatas.js';
import { recordInsuranceSettlement } from './insuranceSettlements.js';
import { computeInsurerQuotePct } from '../lib/insuranceQuotes.js';
import { INSURANCE_COMMISSION_PCT } from '../lib/settlement.js';
import { ensureAceite, setAceiteStatus } from './aceites.js';
import { addLedgerEntry, addNotification, inviteTeamMember } from './misc.js';
import { hashPassword } from '../auth/password.js';
import { logger } from '../lib/logger.js';
import { reserveRate, priceForRate } from '../lib/auctionCore.js';
import { createAuctionBid } from './auctionBids.js';
import { closeDueAuctions } from '../lib/auctionClose.js';
import { OFFERS_RAW, MINHAS_RAW, ACEITES_RAW, HISTORICO_RAW, EXTRATO_RAW, TEAM_MEMBERS, NOTIFICATIONS } from '../data/seed.js';

const STATUS_MAP: Record<string, string> = {
  'No mercado': 'no_mercado',
  'Pendente análise': 'pendente_analise',
  Paga: 'paga',
  Aprovada: 'aprovada',
};

// Formats a date `dias` days from whenever seeding actually runs, DD/MM/YYYY to match
// parseFlexibleDate() — see OFFERS_RAW/MINHAS_RAW in data/seed.ts for why this exists
// instead of a hardcoded string: a fixed future date eventually becomes a fixed past one.
function daysFromNow(dias: number): string {
  const d = new Date(Date.now() + dias * 24 * 60 * 60 * 1000);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

/**
 * As contas de demonstração documentadas no README, em um lugar só.
 *
 * Fonte única de propósito: é desta lista que `seedIfEmpty()` cria as contas e é dela que
 * `seedMissingDemoAccounts()` completa um banco antigo. Se fossem duas listas, a segunda
 * envelheceria sem ninguém notar — que é exatamente o bug que a segunda existe pra consertar.
 */
export const DEMO_ACCOUNTS: { email: string; nome: string; companyName: string; role: Role; insurerKey?: string }[] = [
  { email: 'investidor@lastro.demo', nome: 'Marina Costa', companyName: 'Kayrós Capital', role: 'investidor' },
  { email: 'cedente@lastro.demo', nome: 'Marina Costa', companyName: 'Fornecedor Lima Ltda', role: 'cedente' },
  { email: 'sacado@lastro.demo', nome: 'Marina Costa', companyName: 'Grupo Atlas Varejo', role: 'sacado' },
  { email: 'admin@lastro.demo', nome: 'Equipe Lastro', companyName: 'Lastro (plataforma)', role: 'admin' },
  { email: 'seguradora@lastro.demo', nome: 'Equipe Too', companyName: 'Too Seguros', role: 'seguradora', insurerKey: 'too' },
  // O papel 'auditor' existia sem nenhuma conta semeada: era alcançável só criando uma à mão
  // pelo back-office (POST /admin/auditores), então o painel somente-leitura não podia ser
  // demonstrado. Continua fora do enum de registro público (routes/auth.ts) de propósito —
  // uma conta que lê o log de auditoria de todos os tenants não deve ser auto-servível —, e
  // esta aqui só existe porque todo o bloco de contas demo é pulado em produção por padrão
  // (ver demoProibidoAqui abaixo).
  { email: 'auditor@lastro.demo', nome: 'Auditoria Independente', companyName: 'Auditoria Externa', role: 'auditor' },
];

/** A conta que identifica um banco como sendo de demonstração. Ver seedMissingDemoAccounts. */
const ANCORA_DEMO = 'investidor@lastro.demo';

/**
 * Demo accounts (including admin@lastro.demo) use a fixed, publicly-documented password
 * (see README) — fine for local/dev/staging, a real vulnerability on an internet-facing
 * production deployment. Refuse to auto-create them there unless someone explicitly opts in
 * (SEED_DEMO_DATA=true — e.g. a public sales-demo environment that happens to run with
 * NODE_ENV=production). The real first admin account for a genuine production deployment
 * should come from `npm run create-admin` instead (see server/src/scripts/createAdmin.ts and
 * DEPLOY.md), which takes a real, operator-chosen password and is never documented publicly.
 */
function demoProibidoAqui(): boolean {
  return process.env.NODE_ENV === 'production' && process.env.SEED_DEMO_DATA !== 'true';
}

/**
 * Cria as contas de demonstração que faltam num banco que JÁ foi semeado.
 *
 * `seedIfEmpty()` é tudo-ou-nada: sai na primeira linha se a tabela `users` tiver qualquer
 * registro. Toda conta acrescentada à lista DEPOIS que alguém já rodou a aplicação uma vez
 * nunca chega no banco dessa pessoa, e o sintoma é péssimo de diagnosticar: o login responde
 * "E-mail ou senha incorretos" tanto para senha errada quanto para e-mail inexistente
 * (routes/auth.ts — deliberado, não confirmar se um e-mail está cadastrado). Foi o que
 * aconteceu com `auditor@lastro.demo`, acrescentado depois dos outros cinco: em todo banco de
 * desenvolvimento anterior a ele a conta simplesmente não existe, e a tela diz que a senha
 * está errada.
 *
 * Age só num banco que já é de demonstração, reconhecido pela conta âncora. Num banco real
 * (que nunca teve a âncora) não cria nada — injetar conta com senha pública documentada é
 * precisamente o que o guard de produção existe pra impedir. Não semeia dado nenhum: só a
 * conta que falta.
 */
export async function seedMissingDemoAccounts(): Promise<number> {
  if (demoProibidoAqui()) return 0;
  if (!getUserByEmail(ANCORA_DEMO)) return 0;

  const faltando = DEMO_ACCOUNTS.filter((c) => !getUserByEmail(c.email));
  if (faltando.length === 0) return 0;

  const senha = await hashPassword('demo1234');
  for (const conta of faltando) createUser({ ...conta, passwordHash: senha });
  logger.info(`[seed] contas de demonstração que faltavam neste banco foram criadas: ${faltando.map((c) => c.email).join(', ')}`);
  return faltando.length;
}

export async function seedIfEmpty() {
  const count = (db.prepare('SELECT COUNT(*) as n FROM users').get() as { n: number }).n;
  if (count > 0) return;

  // Ver demoProibidoAqui: senha pública documentada nunca entra sozinha num banco de produção.
  if (demoProibidoAqui()) {
    logger.warn(
      '[seed] Skipping demo data seed: NODE_ENV=production and SEED_DEMO_DATA is not "true". ' +
        'The database has no users yet — create your own first admin account with `npm run create-admin` (see DEPLOY.md).'
    );
    return;
  }

  const demoPassword = await hashPassword('demo1234');

  // Criadas a partir de DEMO_ACCOUNTS pra que a lista seja fonte única — é dela que
  // seedMissingDemoAccounts() completa um banco de desenvolvimento antigo.
  const contas = new Map(DEMO_ACCOUNTS.map((c) => [c.email, createUser({ ...c, passwordHash: demoPassword })]));
  const investidor = contas.get('investidor@lastro.demo')!;

  // Uma apólice semeada precisa ter a cobrança REGISTRADA, não só a seguradora apontada. O
  // painel da seguradora soma o que está em insurance_settlements — o único registro do que
  // foi de fato cobrado. Sem isto, a conta demo abre com apólices que ninguém pagou e prêmio
  // zero; e a alternativa, estimar o prêmio na hora de exibir, é exatamente o bug que fazia
  // a seguradora ver um faturamento que não era o dela (premioPct fixo do catálogo em vez da
  // cotação real daquela duplicata).
  const segurarNoSeed = (duplicataId: string, insurerKey: string, risco: { score: number | null; valor: number; vencimento: string }) => {
    setInsurer(duplicataId, insurerKey);
    const premio = risco.valor * (computeInsurerQuotePct(insurerKey, risco) / 100);
    recordInsuranceSettlement({
      duplicataId,
      investorId: investidor.id,
      insurerKey,
      premio,
      comissaoLastro: premio * INSURANCE_COMMISSION_PCT,
      repasseSeguradora: premio * (1 - INSURANCE_COMMISSION_PCT),
    });
  };
  const cedente = contas.get('cedente@lastro.demo')!;
  const sacado = contas.get('sacado@lastro.demo')!;
  approveKyb(investidor.id);
  // Kayrós Capital é um fundo de investimento — sem veículo classificado a conta seria
  // aprovada e mesmo assim incapaz de dar lance (lib/auctionCore.ts).
  setVeiculo(investidor.id, 'fundo');
  // Demo accounts start on the top plans so the full feature set (Automação de Lances,
  // Comparador, Desenvolvedores) is visible out of the box — a freshly self-registered
  // account starts on Básico instead, so the paywall itself is also demoable.
  updateSubscription(investidor.id, { plan: 'pro', subscriptionStatus: 'active_demo' });
  updateSubscription(cedente.id, { plan: 'empresarial', subscriptionStatus: 'active_demo' });

  // Marketplace offers — other (unregistered) companies' duplicatas available for auction.
  // Achado corrigido: duas ofertas seedadas aqui costumavam ter aceite 'aguardando'
  // enquanto já estavam 'no_mercado' — exatamente o estado que dispararLeilao
  // (routes/minhas.ts) agora bloqueia (uma duplicata só entra em negociação depois do
  // aceite confirmado). O cenário "aguardando aceite" continua demonstrado, só que nas
  // duplicatas certas (ACEITES_RAW/extraForSacado abaixo, que ficam 'pendente_analise' —
  // nunca leiloadas — não neste marketplace).
  const OFFER_ACEITE_STATUS: Record<number, 'aceita' | 'contestada'> = {
    1: 'aceita', 2: 'aceita', 3: 'aceita', 4: 'contestada', 5: 'aceita', 6: 'aceita',
  };
  for (const o of OFFERS_RAW) {
    const vencimento = daysFromNow(o.vencimentoDiasOffset);
    const d = createDuplicata({
      cedenteId: null,
      cedenteNome: o.cedente,
      sacadoNome: o.sacado,
      sacadoCnpj: '',
      valor: o.valor,
      vencimento,
      emissao: vencimento,
      status: 'aprovada',
      lastroPct: 100,
      seguro: o.id <= 2,
      desagio: o.desagio,
    });
    if (o.id <= 2) segurarNoSeed(d.id, 'too', { score: d.score, valor: d.valor, vencimento: d.vencimento });
    dispararLeilao(d.id, new Date(Date.now() + o.countdownSec * 1000).toISOString());
    const aceite = ensureAceite(d.id, 'Aceite confirmado na emissão');
    setAceiteStatus(aceite.id, OFFER_ACEITE_STATUS[o.id] ?? 'aguardando');
  }

  // An overdue, insured, never-sold duplicata so the demo seguradora account has a
  // real sinistro (claim) waiting to be decided.
  const overdue = createDuplicata({
    cedenteId: null,
    cedenteNome: 'Comércio Vale Verde Ltda',
    sacadoNome: 'Mercado Bom Retiro',
    sacadoCnpj: '',
    valor: 27500,
    vencimento: '10/01/2026',
    emissao: '10/12/2025',
    status: 'aprovada',
    lastroPct: 100,
    seguro: true,
  });
  segurarNoSeed(overdue.id, 'too', { score: overdue.score, valor: overdue.valor, vencimento: overdue.vencimento });

  // Cedente demo account's own issued duplicatas.
  for (const m of MINHAS_RAW) {
    const vencimento = typeof m.vencimentoDiasOffset === 'number' ? daysFromNow(m.vencimentoDiasOffset) : m.vencimento!;
    const d = createDuplicata({
      cedenteId: cedente.id,
      cedenteNome: cedente.company_name,
      sacadoNome: m.sacado,
      sacadoCnpj: '',
      valor: m.valor,
      vencimento,
      emissao: m.emissao,
      status: STATUS_MAP[m.status] ?? 'pendente_analise',
      lastroPct: m.lastro,
      seguro: false,
    });
    if (d.status === 'no_mercado') {
      // Achado corrigido: dispararLeilao (routes/minhas.ts) agora exige aceite
      // confirmado antes de sair de 'aprovada' — sem isso, uma duplicata seedada
      // diretamente como 'no_mercado' ficava sem nenhum registro de aceite (a rota
      // HTTP real nunca deixaria chegar nesse estado).
      const aceite = ensureAceite(d.id, 'Aceite confirmado na emissão');
      setAceiteStatus(aceite.id, 'aceita');
      dispararLeilao(d.id, new Date(Date.now() + 3600 * 6 * 1000).toISOString());
    }
  }

  // Duplicatas awaiting the sacado's manifestation (Aceite do Sacado / Portal do Sacado).
  for (const a of ACEITES_RAW) {
    const d = createDuplicata({
      cedenteId: cedente.id,
      cedenteNome: cedente.company_name,
      sacadoNome: a.sacado,
      sacadoCnpj: '',
      valor: a.valor,
      vencimento: '',
      emissao: new Date().toLocaleDateString('pt-BR'),
      status: 'pendente_analise',
      lastroPct: 100,
      seguro: false,
      id: a.duplicataId,
    });
    ensureAceite(d.id, a.prazo);
  }
  // A couple more, from other suppliers, so the demo sacado account has several pending items.
  const extraForSacado = [
    { cedente: 'Distribuidora ABC', valor: 32000, prazo: '5 dias úteis restantes' },
    { cedente: 'Serviços XYZ Ltda', valor: 15400, prazo: '9 dias úteis restantes' },
  ];
  for (const e of extraForSacado) {
    const d = createDuplicata({
      cedenteId: cedente.id,
      cedenteNome: e.cedente,
      sacadoNome: sacado.company_name,
      sacadoCnpj: '',
      valor: e.valor,
      vencimento: '',
      emissao: new Date().toLocaleDateString('pt-BR'),
      status: 'pendente_analise',
      lastroPct: 100,
      seguro: false,
    });
    ensureAceite(d.id, e.prazo);
  }

  // Um leilão que JÁ fechou, arrematado pelo investidor demo. Enquanto comprar era
  // instantâneo, qualquer clique em "Comprar" virava posição na hora; agora o vencedor sai
  // do fechamento no prazo (lib/auctionClose.ts), então a conta demo precisa de pelo menos
  // uma posição em aberto vinda de um leilão real — é ela que a tela de mercado secundário
  // tem pra revender. O caminho aqui é o de produção inteiro: lance na tabela auction_bids
  // e adjudicação por closeDueAuctions, nada inserido à mão em purchases.
  const arrematada = createDuplicata({
    cedenteId: cedente.id,
    cedenteNome: cedente.company_name,
    sacadoNome: 'Grupo Atlas Varejo',
    sacadoCnpj: '',
    valor: 42000,
    vencimento: daysFromNow(45),
    emissao: daysFromNow(-20),
    status: 'aprovada',
    lastroPct: 100,
    seguro: false,
  });
  setAceiteStatus(ensureAceite(arrematada.id, 'Aceite confirmado na emissão').id, 'aceita');
  dispararLeilao(arrematada.id, new Date(Date.now() - 2 * 3600 * 1000).toISOString());
  const reserva = reserveRate(arrematada.id);
  if (reserva) {
    // Lance 0,25 p.p. melhor (mais barato pro cedente) que a reserva — um leilão em que o
    // investidor de fato disputou, não um em que ele aceitou o preço de tabela.
    const taxaVencedora = Math.max(0.01, reserva.taxaAm - 0.25);
    createAuctionBid(arrematada.id, investidor.id, taxaVencedora, priceForRate(arrematada.id, taxaVencedora) ?? reserva.preco);
    closeDueAuctions(new Date().toISOString(), arrematada.id);
  }

  // Historical (settled) purchases for the demo investor, so Carteira & Histórico isn't empty.
  for (const h of HISTORICO_RAW) {
    // O vencimento é a data da compra MAIS o prazo. Usar `h.data` para emissão, vencimento e
    // data da compra ao mesmo tempo dava carência zero — ninguém antecipa um recebível no dia
    // em que ele vence, e era esse dado que produzia retornos anualizados absurdos.
    const compraEm = new Date(h.data.split('/').reverse().join('-'));
    const venceEm = new Date(compraEm.getTime() + h.prazoDias * 24 * 3600 * 1000);
    const vencimentoBr = `${String(venceEm.getUTCDate()).padStart(2, '0')}/${String(venceEm.getUTCMonth() + 1).padStart(2, '0')}/${venceEm.getUTCFullYear()}`;
    const d = createDuplicata({
      cedenteId: null,
      cedenteNome: h.empresa,
      sacadoNome: h.empresa,
      sacadoCnpj: '',
      valor: h.investido,
      vencimento: vencimentoBr,
      emissao: h.data,
      status: 'paga',
      lastroPct: 100,
      seguro: false,
    });
    db.prepare('INSERT INTO purchases (duplicata_id, investor_id, valor, taxa, retorno, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      d.id,
      investidor.id,
      h.investido,
      '',
      h.retorno,
      compraEm.toISOString()
    );
  }

  for (const e of EXTRATO_RAW) {
    addLedgerEntry(investidor.id, e.data, e.descricao, e.valor);
  }

  for (const m of TEAM_MEMBERS.slice(1)) {
    inviteTeamMember(investidor.id, m.nome, m.email);
    inviteTeamMember(cedente.id, m.nome, m.email);
  }

  for (const n of NOTIFICATIONS) {
    addNotification(investidor.id, n.text, n.color);
    addNotification(cedente.id, n.text, n.color);
    addNotification(sacado.id, n.text, n.color);
  }
}
