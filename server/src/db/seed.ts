import { db } from './index.js';
import { createUser, approveKyb } from './users.js';
import { createDuplicata, dispararLeilao } from './duplicatas.js';
import { ensureAceite, setAceiteStatus } from './aceites.js';
import { addLedgerEntry, addNotification, inviteTeamMember } from './misc.js';
import { hashPassword } from '../auth/password.js';
import { OFFERS_RAW, MINHAS_RAW, ACEITES_RAW, HISTORICO_RAW, EXTRATO_RAW, TEAM_MEMBERS, NOTIFICATIONS } from '../data/seed.js';

const STATUS_MAP: Record<string, string> = {
  'No mercado': 'no_mercado',
  'Pendente análise': 'pendente_analise',
  Paga: 'paga',
  Aprovada: 'aprovada',
};

export async function seedIfEmpty() {
  const count = (db.prepare('SELECT COUNT(*) as n FROM users').get() as { n: number }).n;
  if (count > 0) return;

  const demoPassword = await hashPassword('demo1234');

  const investidor = createUser({ email: 'investidor@lastro.demo', passwordHash: demoPassword, nome: 'Marina Costa', companyName: 'Kayrós Capital', role: 'investidor' });
  const cedente = createUser({ email: 'cedente@lastro.demo', passwordHash: demoPassword, nome: 'Marina Costa', companyName: 'Fornecedor Lima Ltda', role: 'cedente' });
  const sacado = createUser({ email: 'sacado@lastro.demo', passwordHash: demoPassword, nome: 'Marina Costa', companyName: 'Grupo Atlas Varejo', role: 'sacado' });
  createUser({ email: 'admin@lastro.demo', passwordHash: demoPassword, nome: 'Equipe Lastro', companyName: 'Lastro (plataforma)', role: 'admin' });
  approveKyb(investidor.id);

  // Marketplace offers — other (unregistered) companies' duplicatas available for auction.
  const OFFER_ACEITE_STATUS: Record<number, 'aceita' | 'aguardando' | 'contestada'> = {
    1: 'aceita', 2: 'aguardando', 3: 'aceita', 4: 'contestada', 5: 'aceita', 6: 'aguardando',
  };
  for (const o of OFFERS_RAW) {
    const d = createDuplicata({
      cedenteId: null,
      cedenteNome: o.cedente,
      sacadoNome: o.sacado,
      sacadoCnpj: '',
      valor: o.valor,
      vencimento: o.vencimento,
      emissao: o.vencimento,
      status: 'aprovada',
      lastroPct: 100,
      seguro: false,
      desagio: o.desagio,
    });
    dispararLeilao(d.id, new Date(Date.now() + o.countdownSec * 1000).toISOString());
    const aceite = ensureAceite(d.id, 'Aceite confirmado na emissão');
    setAceiteStatus(aceite.id, OFFER_ACEITE_STATUS[o.id] ?? 'aguardando');
  }

  // Cedente demo account's own issued duplicatas.
  for (const m of MINHAS_RAW) {
    const d = createDuplicata({
      cedenteId: cedente.id,
      cedenteNome: cedente.company_name,
      sacadoNome: m.sacado,
      sacadoCnpj: '',
      valor: m.valor,
      vencimento: m.vencimento,
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
