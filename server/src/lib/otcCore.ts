import { getDuplicata } from '../db/duplicatas.js';
import { getAceiteByDuplicata } from '../db/aceites.js';
import { getActivePurchaseByDuplicata, getPurchaseById, getListingForPurchase, setListingStatus } from '../db/resaleListings.js';
import { getUserById } from '../db/users.js';
import {
  createOtcNegociacao,
  getOtcNegociacao,
  getOtcAbertaEntre,
  listOtcDoUsuario,
  listOtcRodadas,
  addOtcRodada,
  setOtcContraproposta,
  setOtcStatus,
  expireOtcVencidas,
  type OtcNegociacaoRow,
  type OtcPapel,
} from '../db/otc.js';
import { executeResaleTrade, parseValor } from './resaleCore.js';
import { addNotification } from '../db/misc.js';
import { recordAuditEvent } from '../db/audit.js';
import { deliverWebhookEvent } from './webhookDelivery.js';
import { fmtBRL, parseFlexibleDate } from './format.js';
import { COLORS } from '../data/seed.js';
import type { UserRow } from '../db/types.js';

// Balcão (OTC) do mercado secundário — migração 0072.
//
// O que o book (lib/resaleCore.ts) já resolve: o dono de uma posição a anuncia, e quem quiser
// compra pelo preço pedido ou dá um lance que o dono aceita ou recusa.
//
// O que ele NÃO resolve, e é o que existe aqui:
//  - a negociação só começa se o DONO decidir vender. Quem precisa de uma duplicata
//    específica — pra fechar uma concentração, casar um vencimento — não tem como chegar nele;
//  - o lance é uma via só: não há contraproposta, então não há negociação, há leilão de uma
//    ponta;
//  - tudo é público. Uma mesa institucional não expõe ao mercado inteiro que está montando
//    posição num sacado.
//
// Então: proposta dirigida a uma contraparte nomeada, sobre uma posição que não precisa estar
// anunciada, com contraproposta em rodadas, prazo de validade e visibilidade restrita às duas
// partes.
//
// A liquidação é a MESMA do book (executeResaleTrade): OTC é outro jeito de chegar ao preço,
// não outra transação. E os gates são os mesmos de buyResaleListing, revalidados no aceite —
// entre a proposta e o aceite a posição pode ter mudado de mãos, a duplicata pode ter sido
// contestada ou vencido.

/** Teto do prazo de uma proposta firme. Além disso não é proposta, é opção sem prêmio. */
export const OTC_PRAZO_MAX_HORAS = 168;
export const OTC_PRAZO_PADRAO_HORAS = 48;

/**
 * O balcão nasceu só com notificação in-app, e isso o deixava pela metade pra quem ele foi
 * feito: a mesa institucional opera por API, não olhando a tela. Uma proposta dirigida com
 * prazo de 48h correndo que só existe se alguém logar não é uma proposta — é uma aposta de
 * que a contraparte vai entrar no site a tempo.
 *
 * Então todo ato do balcão que exige reação da OUTRA ponta também sai por webhook. Entrega em
 * void, como os demais emissores: a falha do endpoint de um parceiro nunca derruba a operação
 * que já aconteceu.
 */
function avisar(destinatarioId: number, evento: string, neg: OtcNegociacaoRow, extra: Record<string, unknown> = {}) {
  void deliverWebhookEvent(destinatarioId, evento, {
    negociacaoId: neg.id,
    duplicataId: neg.duplicata_id,
    valor: neg.valor,
    status: neg.status,
    vezDe: neg.vez_de,
    expiraEm: neg.expira_em,
    ...extra,
  });
}

export interface OtcOutcome<T> {
  status: number;
  body: T | { error: string; message?: string };
}

function papelDe(neg: OtcNegociacaoRow, userId: number): OtcPapel | null {
  if (neg.comprador_id === userId) return 'comprador';
  if (neg.vendedor_id === userId) return 'vendedor';
  return null;
}

function credenciado(user: UserRow, acao: string): { error: string; message: string } | null {
  if (user.role !== 'investidor') return { error: 'forbidden', message: `Apenas contas de investidor podem ${acao}.` };
  if (user.kyb_status !== 'approved')
    return { error: 'kyb_required', message: 'Seu credenciamento institucional ainda está em análise.' };
  return null;
}

/**
 * A posição ainda pode ser negociada? Mesma bateria que buyResaleListing aplica, mais a
 * checagem de que ela continua sendo de quem se pensa que é. Roda na abertura E no aceite:
 * o que valia quando a proposta foi feita pode não valer quando ela é aceita.
 */
function posicaoNegociavel(purchaseId: number, vendedorEsperado: number): { error: string; message: string } | null {
  const purchase = getPurchaseById(purchaseId);
  if (!purchase) return { error: 'not_found', message: 'Posição não encontrada.' };
  // Posição fechada: se outra pessoa detém a duplicata agora, ela mudou de mãos (foi vendida
  // no book ou noutro balcão enquanto esta negociação corria) — dizer só "não está ativa"
  // esconde de quem está na mesa o que de fato aconteceu.
  if (!purchase.active) {
    const outra = getActivePurchaseByDuplicata(purchase.duplicata_id);
    return outra
      ? { error: 'stale_position', message: 'Esta posição já mudou de mãos — a negociação não vale mais.' }
      : { error: 'not_found', message: 'Esta posição foi encerrada e não está mais em negociação.' };
  }
  if (purchase.investor_id !== vendedorEsperado)
    return { error: 'stale_position', message: 'Esta posição já mudou de mãos — a negociação não vale mais.' };

  const duplicata = getDuplicata(purchase.duplicata_id);
  if (!duplicata) return { error: 'not_found', message: 'Duplicata não encontrada.' };
  if (parseFlexibleDate(duplicata.vencimento).getTime() < Date.now())
    return { error: 'expired', message: 'Esta duplicata já venceu.' };

  const aceite = getAceiteByDuplicata(purchase.duplicata_id);
  if (aceite?.status === 'contestada')
    return { error: 'contested', message: 'Esta duplicata está contestada pelo sacado e não pode ser negociada.' };

  // Mesma proteção contra corrida do book: a posição ativa da duplicata tem que ser esta.
  const ativa = getActivePurchaseByDuplicata(purchase.duplicata_id);
  if (!ativa || ativa.id !== purchaseId)
    return { error: 'stale_position', message: 'Esta posição já mudou de mãos — a negociação não vale mais.' };

  return null;
}

export interface OtcView {
  id: number;
  duplicataId: string;
  sacado: string;
  valorFaceFmt: string;
  vencimento: string;
  meuPapel: OtcPapel;
  contraparte: string;
  valorFmt: string;
  valor: number;
  minhaVez: boolean;
  status: string;
  expiraEm: string;
  rodadas: { papel: OtcPapel; autor: string; valorFmt: string; nota: string | null; quando: string }[];
}

function view(neg: OtcNegociacaoRow, viewerId: number): OtcView {
  const d = getDuplicata(neg.duplicata_id);
  const meuPapel = papelDe(neg, viewerId)!;
  const outroId = meuPapel === 'comprador' ? neg.vendedor_id : neg.comprador_id;
  return {
    id: neg.id,
    duplicataId: neg.duplicata_id,
    sacado: d?.sacado_nome ?? '—',
    valorFaceFmt: d ? fmtBRL(d.valor) : '—',
    vencimento: d?.vencimento ?? '—',
    meuPapel,
    contraparte: getUserById(outroId)?.company_name ?? '—',
    valorFmt: fmtBRL(neg.valor),
    valor: neg.valor,
    minhaVez: neg.status === 'aberta' && neg.vez_de === meuPapel,
    status: neg.status,
    expiraEm: neg.expira_em,
    rodadas: listOtcRodadas(neg.id).map((r) => ({
      papel: r.papel,
      autor: getUserById(r.autor_id)?.company_name ?? '—',
      valorFmt: fmtBRL(r.valor),
      nota: r.nota,
      quando: r.created_at,
    })),
  };
}

/**
 * Expira o que venceu e avisa as duas pontas. A expiração é preguiçosa (roda na leitura), e
 * é justamente por isso que o aviso mora aqui: quem integra por webhook não tem como
 * descobrir sozinho que o relógio virou.
 */
function expirarEAvisar() {
  for (const venc of expireOtcVencidas()) {
    avisar(venc.comprador_id, 'otc.encerrada', venc, { motivo: 'expirada' });
    avisar(venc.vendedor_id, 'otc.encerrada', venc, { motivo: 'expirada' });
  }
}

/** Só as duas partes veem uma negociação de balcão. Não existe visão pública disto. */
export function viewMinhasOtc(userId: number): OtcView[] {
  expirarEAvisar();
  return listOtcDoUsuario(userId).map((n) => view(n, userId));
}

export function abrirOtc(
  user: UserRow,
  input: { duplicataId: string; valorRaw: string; prazoHoras?: number; nota?: string }
): OtcOutcome<{ negociacaoId: number; negociacoes: OtcView[] }> {
  const barrado = credenciado(user, 'abrir negociações de balcão');
  if (barrado) return { status: 403, body: barrado };

  const ativa = getActivePurchaseByDuplicata(input.duplicataId);
  if (!ativa) return { status: 404, body: { error: 'not_found', message: 'Ninguém detém esta duplicata no momento.' } };
  if (ativa.investor_id === user.id)
    return { status: 409, body: { error: 'own_position', message: 'Esta posição já é sua — não há com quem negociar.' } };

  const impedimento = posicaoNegociavel(ativa.id, ativa.investor_id);
  if (impedimento) return { status: 409, body: impedimento };

  const valor = parseValor(input.valorRaw);
  if (valor <= 0) return { status: 400, body: { error: 'validation_error', message: 'Informe um valor de proposta válido.' } };

  const horas = input.prazoHoras ?? OTC_PRAZO_PADRAO_HORAS;
  if (!Number.isFinite(horas) || horas <= 0 || horas > OTC_PRAZO_MAX_HORAS)
    return {
      status: 400,
      body: { error: 'validation_error', message: `O prazo da proposta precisa estar entre 1 e ${OTC_PRAZO_MAX_HORAS} horas.` },
    };

  // Uma proposta aberta por vez, por par (posição, comprador): sem isto, dá pra encher a
  // caixa da contraparte com dez propostas e depois escolher qual honrar.
  if (getOtcAbertaEntre(ativa.id, user.id))
    return {
      status: 409,
      body: { error: 'ja_existe', message: 'Você já tem uma negociação aberta sobre esta posição — responda ou cancele antes de abrir outra.' },
    };

  const expiraEm = new Date(Date.now() + horas * 3600 * 1000).toISOString();
  const neg = createOtcNegociacao({
    purchaseId: ativa.id,
    duplicataId: input.duplicataId,
    compradorId: user.id,
    vendedorId: ativa.investor_id,
    valor,
    expiraEm,
    nota: input.nota?.trim() || null,
  });

  addNotification(
    ativa.investor_id,
    `Proposta de balcão de ${fmtBRL(valor)} pela sua posição na duplicata ${input.duplicataId}, de ${user.company_name}.`,
    COLORS.BLUE
  );
  recordAuditEvent(user.id, user.company_name, 'otc.proposta_aberta', {
    negociacaoId: neg.id,
    duplicataId: input.duplicataId,
    valor,
    contraparte: ativa.investor_id,
  });
  // Só pro vendedor: é dele a vez, e é o relógio dele que está correndo.
  avisar(ativa.investor_id, 'otc.proposta_recebida', neg, { de: user.company_name, nota: input.nota?.trim() || null });
  return { status: 200, body: { negociacaoId: neg.id, negociacoes: viewMinhasOtc(user.id) } };
}

export function contrapropor(user: UserRow, negociacaoId: number, valorRaw: string, nota?: string): OtcOutcome<{ negociacoes: OtcView[] }> {
  expirarEAvisar();
  const neg = getOtcNegociacao(negociacaoId);
  const papel = neg ? papelDe(neg, user.id) : null;
  // 404 e não 403 pra quem não é parte: a existência de uma negociação de balcão alheia já é
  // informação — quem não está nela não deve nem saber que ela existe.
  if (!neg || !papel) return { status: 404, body: { error: 'not_found', message: 'Negociação não encontrada.' } };
  if (neg.status !== 'aberta') return { status: 409, body: { error: 'nao_aberta', message: `Esta negociação está ${neg.status}.` } };
  if (neg.vez_de !== papel)
    return { status: 409, body: { error: 'nao_e_sua_vez', message: 'A proposta em cima da mesa é sua — aguarde a resposta da contraparte.' } };

  const valor = parseValor(valorRaw);
  if (valor <= 0) return { status: 400, body: { error: 'validation_error', message: 'Informe um valor de contraproposta válido.' } };

  setOtcContraproposta(negociacaoId, valor, papel === 'comprador' ? 'vendedor' : 'comprador');
  addOtcRodada(negociacaoId, user.id, papel, valor, nota?.trim() || null);

  const outroId = papel === 'comprador' ? neg.vendedor_id : neg.comprador_id;
  addNotification(outroId, `Contraproposta de ${fmtBRL(valor)} na negociação de balcão da duplicata ${neg.duplicata_id}.`, COLORS.BLUE);
  recordAuditEvent(user.id, user.company_name, 'otc.contraproposta', { negociacaoId, duplicataId: neg.duplicata_id, valor });
  // A negociação já mudou no banco; o payload tem que refletir o valor e a vez NOVOS, não o
  // estado que `neg` carregava quando foi lido.
  avisar(outroId, 'otc.contraproposta', getOtcNegociacao(negociacaoId)!, { de: user.company_name, nota: nota?.trim() || null });
  return { status: 200, body: { negociacoes: viewMinhasOtc(user.id) } };
}

export function aceitarOtc(user: UserRow, negociacaoId: number): OtcOutcome<{ negociacoes: OtcView[] }> {
  expirarEAvisar();
  const barrado = credenciado(user, 'fechar negociações de balcão');
  if (barrado) return { status: 403, body: barrado };

  const neg = getOtcNegociacao(negociacaoId);
  const papel = neg ? papelDe(neg, user.id) : null;
  if (!neg || !papel) return { status: 404, body: { error: 'not_found', message: 'Negociação não encontrada.' } };
  if (neg.status !== 'aberta') return { status: 409, body: { error: 'nao_aberta', message: `Esta negociação está ${neg.status}.` } };
  // Quem fez a proposta que está na mesa não pode aceitá-la: aceitar é o ato da contraparte.
  if (neg.vez_de !== papel)
    return { status: 409, body: { error: 'nao_e_sua_vez', message: 'A proposta em cima da mesa é sua — só a contraparte pode aceitá-la.' } };

  // Revalidação no momento do aceite, não da proposta: a posição pode ter mudado de mãos, a
  // duplicata pode ter sido contestada ou vencido enquanto as partes negociavam.
  const impedimento = posicaoNegociavel(neg.purchase_id, neg.vendedor_id);
  if (impedimento) {
    setOtcStatus(negociacaoId, 'cancelada');
    return { status: 409, body: impedimento };
  }

  const duplicata = getDuplicata(neg.duplicata_id)!;
  // Se a posição também estava anunciada no book, o anúncio morre aqui — a mesma posição não
  // pode ser vendida duas vezes.
  const anuncio = getListingForPurchase(neg.purchase_id);
  if (anuncio && anuncio.status === 'ativo') setListingStatus(anuncio.id, 'cancelado');

  const { fee } = executeResaleTrade(
    { id: null, purchase_id: neg.purchase_id, duplicata_id: neg.duplicata_id, seller_id: neg.vendedor_id },
    duplicata,
    neg.comprador_id,
    neg.valor
  );
  setOtcStatus(negociacaoId, 'aceita');

  addNotification(
    neg.vendedor_id,
    `Negociação de balcão fechada: sua posição na duplicata ${neg.duplicata_id} foi vendida por ${fmtBRL(neg.valor)} (líquido de ${fmtBRL(fee)} de taxa de plataforma).`,
    COLORS.GREEN
  );
  addNotification(neg.comprador_id, `Negociação de balcão fechada: você comprou a duplicata ${neg.duplicata_id} por ${fmtBRL(neg.valor)}.`, COLORS.GREEN);
  recordAuditEvent(user.id, user.company_name, 'otc.aceita', {
    negociacaoId,
    duplicataId: neg.duplicata_id,
    valor: neg.valor,
    compradorId: neg.comprador_id,
    vendedorId: neg.vendedor_id,
    anuncioCancelado: anuncio?.status === 'ativo' ? anuncio.id : null,
  });
  // Às DUAS pontas, ao contrário dos demais: aqui não é um pedido de reação, é uma
  // liquidação — cada lado precisa lançar a sua perna, e quem aceitou também precisa do
  // registro pela mesma via que recebeu o resto da negociação.
  const fechada = getOtcNegociacao(negociacaoId)!;
  avisar(neg.vendedor_id, 'otc.aceita', fechada, { papel: 'vendedor', taxaPlataforma: fee, liquido: neg.valor - fee });
  avisar(neg.comprador_id, 'otc.aceita', fechada, { papel: 'comprador', taxaPlataforma: 0, liquido: neg.valor });
  return { status: 200, body: { negociacoes: viewMinhasOtc(user.id) } };
}

/** Recusar encerra; cancelar é o mesmo ato visto do lado de quem propôs. */
export function encerrarOtc(user: UserRow, negociacaoId: number, como: 'recusada' | 'cancelada'): OtcOutcome<{ negociacoes: OtcView[] }> {
  expirarEAvisar();
  const neg = getOtcNegociacao(negociacaoId);
  const papel = neg ? papelDe(neg, user.id) : null;
  if (!neg || !papel) return { status: 404, body: { error: 'not_found', message: 'Negociação não encontrada.' } };
  if (neg.status !== 'aberta') return { status: 409, body: { error: 'nao_aberta', message: `Esta negociação está ${neg.status}.` } };

  setOtcStatus(negociacaoId, como);
  const outroId = papel === 'comprador' ? neg.vendedor_id : neg.comprador_id;
  addNotification(outroId, `A negociação de balcão da duplicata ${neg.duplicata_id} foi encerrada pela contraparte.`, COLORS.AMBER);
  recordAuditEvent(user.id, user.company_name, `otc.${como}`, { negociacaoId, duplicataId: neg.duplicata_id });
  avisar(outroId, 'otc.encerrada', getOtcNegociacao(negociacaoId)!, { motivo: como, por: user.company_name });
  return { status: 200, body: { negociacoes: viewMinhasOtc(user.id) } };
}
