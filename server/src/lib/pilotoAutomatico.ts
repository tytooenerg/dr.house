import { z } from 'zod';
import { db } from '../db/index.js';
import { getDuplicata } from '../db/duplicatas.js';
import { addNotification } from '../db/misc.js';
import { recordAuditEvent } from '../db/audit.js';
import { getSettings, getUserById, updateSettings } from '../db/users.js';
import { abrirLeilao } from './auctionOpen.js';
import { aceiteConfirmado } from './aceiteCore.js';
import { sacarViaPix } from './saque.js';
import { pixEnabled } from './paymentRail.js';
import { modoDemonstracao } from './preflight.js';
import { fmtBRL } from './format.js';
import { logger } from './logger.js';
import { COLORS } from '../data/seed.js';
import type { UserRow, UserSettings } from '../db/types.js';

// Piloto automático da empresa. Depois de emitir, tudo era manual: esperar o aceite, clicar
// em "Disparar leilão", escolher a reserva, reofertar se ninguém desse lance e sacar o
// dinheiro. Para uma empresa pequena, cada passo esquecido é dinheiro que demora a chegar.
//
// Desligado por padrão — a empresa liga cada parte em Conta & Liquidação. Cada ação
// automática passa pelos MESMOS caminhos que o clique faria (abrirLeilao, sacarViaPix), com
// as mesmas travas, e deixa notificação e trilha de auditoria marcadas como automáticas.

/** Quantas vezes um leilão sem lance é relançado sozinho antes de devolver a decisão à empresa. */
export const MAX_RELANCAMENTOS = 3;

export const pilotoSchema = z.object({
  leilaoAoAceitar: z.boolean(),
  // Pior deságio aceito nos leilões automáticos; null = banda de mercado do dia.
  reservaAm: z.number().positive().max(20).nullable(),
  relancarSemLance: z.boolean(),
  saqueAutomaticoPix: z.boolean(),
});

export function pilotoDe(user: UserRow): UserSettings['pilotoAutomatico'] {
  return getSettings(user).pilotoAutomatico;
}

export function salvarPiloto(user: UserRow, piloto: z.infer<typeof pilotoSchema>) {
  updateSettings(user.id, { pilotoAutomatico: piloto });
  recordAuditEvent(user.id, user.company_name, 'piloto.configurado', piloto);
}

function cedenteDa(duplicataId: string): { d: NonNullable<ReturnType<typeof getDuplicata>>; cedente: UserRow } | null {
  const d = getDuplicata(duplicataId);
  if (!d || !d.cedente_id || d.sandbox) return null;
  const cedente = getUserById(d.cedente_id);
  return cedente ? { d, cedente } : null;
}

/**
 * Abre o leilão sozinho quando a duplicata fica pronta (lastro completo + aceite). Chamado
 * quando o aceite vira 'aceita' (portal, link ou tácito) e quando o lastro completa.
 */
export function tentarLeilaoAutomatico(duplicataId: string): boolean {
  const alvo = cedenteDa(duplicataId);
  if (!alvo) return false;
  const { d, cedente } = alvo;
  const piloto = pilotoDe(cedente);
  if (!piloto.leilaoAoAceitar) return false;
  if (d.status !== 'aprovada' || d.lastro_pct !== 100 || !aceiteConfirmado(d.id)) return false;

  const out = abrirLeilao(cedente, d.id, { reservaTaxaAm: piloto.reservaAm ?? undefined });
  if (out.status !== 200) {
    logger.warn({ duplicataId, out }, '[piloto] leilão automático recusado');
    return false;
  }
  recordAuditEvent(cedente.id, `${cedente.company_name} (piloto automático)`, 'piloto.leilao_aberto', { duplicataId: d.id });
  addNotification(cedente.id, `Piloto automático: leilão de ${d.sacado_nome} (${fmtBRL(d.valor)}) aberto assim que o sacado confirmou.`, COLORS.BLUE, 'leilao');
  return true;
}

/**
 * Leilão fechou sem lance: relança sozinho, até MAX_RELANCAMENTOS vezes. Devolve true se
 * relançou (quem chama então não manda o aviso de "voltou para Minhas Duplicatas").
 */
export function tentarRelancar(duplicataId: string): boolean {
  const alvo = cedenteDa(duplicataId);
  if (!alvo) return false;
  const { d, cedente } = alvo;
  if (!pilotoDe(cedente).relancarSemLance) return false;
  if (d.leilao_tentativas >= MAX_RELANCAMENTOS) return false;

  // Relança com a mesma reserva que a empresa escolheu para este leilão.
  const out = abrirLeilao(cedente, d.id, { reservaTaxaAm: d.reserva_taxa_am ?? undefined });
  if (out.status !== 200) return false;
  db.prepare('UPDATE duplicatas SET leilao_tentativas = leilao_tentativas + 1 WHERE id = ?').run(d.id);
  const tentativa = d.leilao_tentativas + 1;
  recordAuditEvent(cedente.id, `${cedente.company_name} (piloto automático)`, 'piloto.leilao_relancado', { duplicataId: d.id, tentativa });
  addNotification(
    cedente.id,
    `Piloto automático: o leilão de ${d.sacado_nome} fechou sem lance e foi relançado (${tentativa}ª de ${MAX_RELANCAMENTOS} tentativas).` +
      (tentativa === MAX_RELANCAMENTOS ? ' Se fechar de novo sem lance, ele volta para você decidir — talvez a reserva esteja baixa.' : ''),
    COLORS.AMBER,
    'leilao'
  );
  return true;
}

/**
 * Depois do arremate, manda o valor líquido para a chave Pix da empresa. Respeita a mesma
 * trava da rota de saque: em produção, com o Pix em modo simulado, não finge um saque — avisa.
 */
export async function saqueAutomatico(cedenteId: number, valor: number, duplicataId: string): Promise<void> {
  const cedente = getUserById(cedenteId);
  if (!cedente || !pilotoDe(cedente).saqueAutomaticoPix || valor <= 0) return;
  if (!pixEnabled && !modoDemonstracao()) {
    addNotification(cedenteId, 'Saque automático não feito: o Pix desta plataforma ainda está em modo simulado. O valor continua no seu saldo.', COLORS.AMBER, 'leilao');
    return;
  }
  const saque = await sacarViaPix(cedente, valor, `Saque automático (duplicata ${duplicataId}) via Pix`);
  if (!saque.ok) {
    addNotification(cedenteId, `Saque automático não feito: ${saque.message} O valor continua no seu saldo.`, COLORS.AMBER, 'leilao');
    return;
  }
  recordAuditEvent(cedenteId, `${cedente.company_name} (piloto automático)`, 'piloto.saque_pix', { duplicataId, valor, simulado: saque.simulado });
  addNotification(cedenteId, `Piloto automático: ${fmtBRL(valor)} enviados para a sua chave Pix${saque.simulado ? ' (simulado)' : ''}.`, COLORS.GREEN, 'leilao');
}
