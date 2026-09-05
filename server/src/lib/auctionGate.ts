import { getDuplicata, isPurchased } from '../db/duplicatas.js';
import { getAceiteByDuplicata } from '../db/aceites.js';

// O portão do leilão vive num módulo próprio (e não em auctionCore.ts) porque
// lib/marketCompute.ts precisa dele para montar a view da oferta, e auctionCore já importa
// computePurchasePrice de marketCompute — juntos os dois fariam um ciclo de import.
//
// Um leilão só aceita lance com o mesmo gate de negociação do resto do sistema: aceite do
// sacado confirmado (explícito ou tácito) e ninguém tendo levado a duplicata antes.
export type AuctionGate = { ok: true } | { ok: false; status: number; error: string; message: string };

export function auctionIsOpen(duplicataId: string): AuctionGate {
  const d = getDuplicata(duplicataId);
  if (!d) return { ok: false, status: 404, error: 'not_found', message: 'Duplicata não encontrada.' };
  // A checagem de "já negociada" vem antes da de status porque uma duplicata comprada sai de
  // 'no_mercado': checar status primeiro responderia not_open a quem, na verdade, chegou
  // tarde — e é `already_purchased` que o resto do sistema (fracionamento) trata.
  if (isPurchased(d.id)) return { ok: false, status: 409, error: 'already_purchased', message: 'Esta duplicata já foi negociada.' };
  if (d.status !== 'no_mercado') return { ok: false, status: 409, error: 'not_open', message: 'Esta duplicata não está em leilão.' };
  if (d.leilao_fechado_em) return { ok: false, status: 409, error: 'auction_closed', message: 'Este leilão já foi encerrado.' };
  if (d.close_at && new Date(d.close_at).getTime() <= Date.now())
    return { ok: false, status: 409, error: 'auction_closed', message: 'O prazo deste leilão já encerrou.' };
  const aceite = getAceiteByDuplicata(d.id);
  if (aceite?.status === 'contestada')
    return { ok: false, status: 409, error: 'contested', message: 'Esta duplicata está contestada e não pode ser negociada.' };
  if (aceite?.status !== 'aceita')
    return { ok: false, status: 409, error: 'aceite_pendente', message: 'Aguardando aceite do sacado (ou o prazo tácito vencer) antes de aceitar lances.' };
  return { ok: true };
}
