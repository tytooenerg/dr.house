import { addLedgerEntry, listLedger } from '../db/misc.js';
import { recordPixPayout } from '../db/pix.js';
import { getSettings } from '../db/users.js';
import { enviarPix } from './paymentRail.js';
import { fmtBRL } from './format.js';
import type { UserRow } from '../db/types.js';

// Saque por Pix — a mesma operação para o botão "Sacar" de Conta & Liquidação
// (routes/account.ts) e para o saque automático do piloto (lib/pilotoAutomatico.ts). Antes
// morava inteira dentro da rota; o automático teria de copiá-la. enviarPix é real quando o
// PSP está configurado e cai no modo simulado, rotulado, quando não está.

export function saldoDisponivel(userId: number): number {
  return listLedger(userId).reduce((sum, r) => sum + r.valor, 0);
}

export type SaqueOutcome =
  | { ok: true; valor: number; simulado: boolean }
  | { ok: false; status: 409; error: 'no_pix_key' | 'insufficient_balance'; message: string };

export async function sacarViaPix(user: UserRow, valor: number, rotulo = 'Saque via Pix'): Promise<SaqueOutcome> {
  const settings = getSettings(user);
  if (!settings.pixChave) {
    return { ok: false, status: 409, error: 'no_pix_key', message: 'Cadastre uma chave Pix antes de sacar.' };
  }
  const disponivel = saldoDisponivel(user.id);
  if (valor > disponivel + 1e-9) {
    return { ok: false, status: 409, error: 'insufficient_balance', message: `Saldo disponível: ${fmtBRL(disponivel)}` };
  }
  const payout = await enviarPix({ chaveDestino: settings.pixChave, valor, descricao: `Saque Lastro — ${user.company_name}` });
  recordPixPayout({ userId: user.id, valor, chaveDestino: settings.pixChave, simulado: payout.simulado, endToEndId: payout.endToEndId });
  addLedgerEntry(user.id, new Date().toLocaleDateString('pt-BR'), `${rotulo} para ${settings.pixChave}${payout.simulado ? ' (simulado)' : ''}`, -valor);
  return { ok: true, valor, simulado: payout.simulado };
}
