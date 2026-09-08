import type { UserRow } from '../db/types.js';
import { getDuplicata, dispararLeilao } from '../db/duplicatas.js';
import { effectiveOwnerId } from '../db/users.js';
import { aceiteConfirmado } from './aceiteCore.js';
import { deliverWebhookEvent } from './webhookDelivery.js';
import { recordAuditEvent } from '../db/audit.js';

// Abertura de leilão em um lugar só. Antes ela existia duas vezes — o botão da tela
// (routes/minhas.ts) e o "Executar" do CFO (routes/cashflow.ts) — e as duas cópias não
// faziam a mesma coisa: só a primeira emitia 'leilao.aberto'. Quem assinava o webhook
// perdia silenciosamente todo leilão aberto pelo motor de decisão, que é justamente o
// caminho automatizado que mais interessa a quem integra.
//
// É o mesmo raciocínio que placeAuctionBid já aplica a 'lance.recebido': emitir no núcleo,
// não na rota, cobre todos os caminhos de uma vez — agora incluindo a API pública
// (routes/v1.ts), que é a porta por onde o n8n do cedente entra.

// Teto de sanidade pra taxa de reserva. Não é uma regra de mercado — é uma barreira contra
// dedo errado (digitar "150" quando queria "1,50"), que a essa altura significaria aceitar
// entregar a duplicata quase de graça.
export const RESERVA_MAX_PCT = 20;

// Prazo padrão do leilão, o mesmo que o botão da tela sempre usou. A API deixa escolher
// porque um workflow que roda de madrugada precisa de um prazo que cubra o horário
// comercial seguinte; o teto de uma semana existe pra que "duração" não vire "para sempre".
export const DURACAO_PADRAO_HORAS = 6;
export const DURACAO_MAX_HORAS = 168;

export interface AbrirLeilaoInput {
  /** Pior deságio mensal que o cedente aceita. Sem ela vale a banda de mercado. */
  reservaTaxaAm?: number | string;
  duracaoHoras?: number;
}

export interface AbrirLeilaoOk {
  duplicataId: string;
  closeAt: string;
  reservaTaxaAm: number | null;
}

export type AbrirLeilaoResult =
  | { status: 200; body: AbrirLeilaoOk }
  | { status: 400 | 404 | 409; body: { error: string; message?: string } };

/** Converte a reserva recebida (número ou string "1,80") em número, ou `null` se não veio. */
function parseReserva(raw: number | string | undefined): number | null | 'invalida' {
  if (raw === undefined || String(raw).trim() === '') return null;
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0 || n > RESERVA_MAX_PCT) return 'invalida';
  return n;
}

export function abrirLeilao(user: UserRow, duplicataId: string, input: AbrirLeilaoInput = {}): AbrirLeilaoResult {
  const d = getDuplicata(duplicataId);
  // Escopo por effectiveOwnerId, não por user.id: uma conta de equipe enxerga as duplicatas
  // do titular em GET /minhas (que já lista por effectiveOwnerId) e até aqui levava 404 ao
  // tentar abrir o leilão de uma delas — via, e não podia agir.
  if (!d || d.cedente_id !== effectiveOwnerId(user)) return { status: 404, body: { error: 'not_found' } };

  if (d.lastro_pct !== 100 || d.status !== 'aprovada')
    return { status: 409, body: { error: 'not_ready', message: 'Esta duplicata ainda não está pronta para leilão.' } };

  // Uma duplicata só entra em negociação depois que o sacado aceita — explícito ou tácito,
  // ver lib/aceiteCore.ts. Antes disso nem chega a 'no_mercado', o que protege de graça
  // compra direta, cestas e auto-bid, que todos operam sobre listMarketplace().
  if (!aceiteConfirmado(d.id))
    return {
      status: 409,
      body: {
        error: 'aceite_pendente',
        message: 'Aguardando aceite do sacado (ou o prazo tácito vencer) antes de poder negociar esta duplicata.',
      },
    };

  const reserva = parseReserva(input.reservaTaxaAm);
  if (reserva === 'invalida')
    return {
      status: 400,
      body: { error: 'validation_error', message: `A taxa máxima precisa ser um número entre 0 e ${RESERVA_MAX_PCT}% a.m.` },
    };

  const horas = input.duracaoHoras ?? DURACAO_PADRAO_HORAS;
  if (!Number.isFinite(horas) || horas <= 0 || horas > DURACAO_MAX_HORAS)
    return {
      status: 400,
      body: { error: 'validation_error', message: `A duração do leilão precisa estar entre 1 e ${DURACAO_MAX_HORAS} horas.` },
    };

  const closeAt = new Date(Date.now() + horas * 3600 * 1000).toISOString();
  dispararLeilao(d.id, closeAt, reserva ?? undefined);

  // Entrega em void de propósito: uma falha de webhook nunca derruba a operação que já
  // aconteceu — mesmo padrão dos outros emissores.
  void deliverWebhookEvent(d.cedente_id!, 'leilao.aberto', {
    duplicataId: d.id,
    sacado: d.sacado_nome,
    valor: d.valor,
    closeAt,
    reservaTaxaAm: reserva,
  });
  recordAuditEvent(user.id, user.company_name, 'leilao.aberto', {
    duplicataId: d.id,
    closeAt,
    reservaTaxaAm: reserva,
  });

  return { status: 200, body: { duplicataId: d.id, closeAt, reservaTaxaAm: reserva } };
}
