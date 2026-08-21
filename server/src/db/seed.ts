import { db } from './index.js';
import { createUser, approveKyb, updateSubscription } from './users.js';
import { createDuplicata, dispararLeilao, setInsurer } from './duplicatas.js';
import { ensureAceite, setAceiteStatus } from './aceites.js';
import { addLedgerEntry, addNotification, inviteTeamMember } from './misc.js';
import { hashPassword } from '../auth/password.js';
import { logger } from '../lib/logger.js';
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

export async function seedIfEmpty() {
  const count = (db.prepare('SELECT COUNT(*) as n FROM users').get() as { n: number }).n;
  if (count > 0) return;

  // Demo accounts (including admin@lastro.demo) use a fixed, publicly-documented password
  // (see README) — fine for local/dev/staging, a real vulnerability on an internet-facing
  // production deployment with an empty database. Refuse to auto-create them there unless
  // someone explicitly opts in (SEED_DEMO_DATA=true — e.g. a public sales-demo environment
  // that happens to run with NODE_ENV=production). The real first admin account for a
  // genuine production deployment should come from `npm run create-admin` instead (see
  // server/src/scripts/createAdmin.ts and DEPLOY.md), which takes a real, operator-chosen
  // password and is never documented publicly.
  if (process.env.NODE_ENV === 'production' && process.env.SEED_DEMO_DATA !== 'true') {
    logger.warn(
      '[seed] Skipping demo data seed: NODE_ENV=production and SEED_DEMO_DATA is not "true". ' +
        'The database has no users yet — create your own first admin account with `npm run create-admin` (see DEPLOY.md).'
    );
    return;
  }

  const demoPassword = await hashPassword('demo1234');

  const investidor = createUser({ email: 'investidor@lastro.demo', passwordHash: demoPassword, nome: 'Marina Costa', companyName: 'Kayrós Capital', role: 'investidor' });
  const cedente = createUser({ email: 'cedente@lastro.demo', passwordHash: demoPassword, nome: 'Marina Costa', companyName: 'Fornecedor Lima Ltda', role: 'cedente' });
  const sacado = createUser({ email: 'sacado@lastro.demo', passwordHash: demoPassword, nome: 'Marina Costa', companyName: 'Grupo Atlas Varejo', role: 'sacado' });
  createUser({ email: 'admin@lastro.demo', passwordHash: demoPassword, nome: 'Equipe Lastro', companyName: 'Lastro (plataforma)', role: 'admin' });
  createUser({ email: 'seguradora@lastro.demo', passwordHash: demoPassword, nome: 'Equipe Too', companyName: 'Too Seguros', role: 'seguradora', insurerKey: 'too' });
  approveKyb(investidor.id);
  // Demo accounts start on the top plans so the full feature set (Automação de Lances,
  // Comparador, Desenvolvedores) is visible out of the box — a freshly self-registered
  // account starts on Básico instead, so the paywall itself is also demoable.
  updateSubscription(investidor.id, { plan: 'pro', subscriptionStatus: 'active_demo' });
  updateSubscription(cedente.id, { plan: 'empresarial', subscriptionStatus: 'active_demo' });

  // Marketplace offers — other (unregistered) companies' duplicatas available for auction.
  const OFFER_ACEITE_STATUS: Record<number, 'aceita' | 'aguardando' | 'contestada'> = {
    1: 'aceita', 2: 'aguardando', 3: 'aceita', 4: 'contestada', 5: 'aceita', 6: 'aguardando',
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
    if (o.id <= 2) setInsurer(d.id, 'too');
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
  setInsurer(overdue.id, 'too');

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

  // Historical (settled) purchases for the demo investor, so Carteira & Histórico isn't empty.
  for (const h of HISTORICO_RAW) {
    const d = createDuplicata({
      cedenteId: null,
      cedenteNome: h.empresa,
      sacadoNome: h.empresa,
      sacadoCnpj: '',
      valor: h.investido,
      vencimento: h.data,
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
      new Date(h.data.split('/').reverse().join('-')).toISOString()
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
