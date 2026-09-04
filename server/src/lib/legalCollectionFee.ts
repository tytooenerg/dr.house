import { addLedgerEntry } from '../db/misc.js';
import { getActivePurchaseByDuplicata } from '../db/resaleListings.js';
import { setStatus as setDuplicataStatus } from '../db/duplicatas.js';
import { getFloatSetting, setPlatformSetting } from '../db/platformSettings.js';
import { recordLegalCollectionFee, hasFeeAlreadyCharged } from '../db/legalCollectionFees.js';
import { getFundoSistemaUserIdIfExists, fundoRetornoDePagamento } from './confirmingFundo.js';
import { fmtBRL } from './format.js';
import type { DuplicataRow } from '../db/types.js';

// A real success fee on cobrança jurídica: charged only once a duplicata escalated
// through the Jurídico flow (lib/legalCollection.ts) is actually recovered. Admin-tunable
// instead of a hardcoded constant, same pattern as the Compliance AI Engine's suspend
// threshold — see lib/complianceEngine.ts getSuspendThreshold/setSuspendThreshold.
const FEE_PCT_KEY = 'legal_collection_fee_pct';
export const DEFAULT_SUCCESS_FEE_PCT = 5;

export function getSuccessFeePct(): number {
  return getFloatSetting(FEE_PCT_KEY, DEFAULT_SUCCESS_FEE_PCT);
}

export function setSuccessFeePct(value: number, updatedBy?: number) {
  setPlatformSetting(FEE_PCT_KEY, String(value), updatedBy);
}

export interface CurrentCreditor {
  userId: number;
  role: 'cedente' | 'investidor';
}

// The credor at the moment of recovery — an active (not yet resold) purchase means an
// investidor currently holds the right to receive, even if the duplicata changed hands
// through the mercado secundário; otherwise it's still the cedente's own receivable.
// Mirrors the same active-purchase lookup lib/resaleCore.ts uses for resale eligibility.
export function currentCreditorFor(duplicata: DuplicataRow): CurrentCreditor | null {
  const purchase = getActivePurchaseByDuplicata(duplicata.id);
  if (purchase) return { userId: purchase.investor_id, role: 'investidor' };
  if (duplicata.cedente_id) return { userId: duplicata.cedente_id, role: 'cedente' };
  return null;
}

export interface RecordRecoveryResult {
  feeValor: number;
  feePct: number;
  chargedTo: CurrentCreditor;
}

// Credits whoever currently holds the receivable with the recovered principal, net of
// Lastro's success fee, and marks the duplicata 'paga' — the natural real use for that
// status (previously only present in static demo seed data, never set by any real flow).
// Only ever charged once per duplicata. Used to only debit the fee and never credit the
// recovery itself, on the theory that a judicial recovery pays the creditor directly,
// off-platform — but that's the same gap the "pagamento no vencimento" fix (see
// lib/settlement.ts's settleAtMaturity) closed for the on-time path: every other real
// money movement for a duplicata bought through Lastro settles through Lastro's own
// ledger, and a legal recovery is no different — the admin recording it here has already
// confirmed the money is real (unlike the happy path's sacado self-report, this is an
// admin-confirmed event), so crediting it is at least as honest as reportPayment already is.
export function recordRecovery(duplicata: DuplicataRow, recoveredValor: number, recordedBy?: number): RecordRecoveryResult | null {
  if (hasFeeAlreadyCharged(duplicata.id)) return null;
  // Achado corrigido (simulação multi-papel, server/test/full-lifecycle-all-roles.test.ts):
  // hasFeeAlreadyCharged só sabe de uma recuperação jurídica ANTERIOR — nunca de uma
  // duplicata já paga por outro canal (sinistro aprovado em lib/seguradoraCore.ts,
  // reportPayment no vencimento). checkCollectionEligibility (lib/legalCollection.ts)
  // também não olha duplicata.status, e listOverdueDuplicatas só filtra a LISTAGEM (status
  // IN ('aprovada','vendida')) — um POST .../recuperar/:duplicataId chamado direto pelo ID
  // (sem passar pela listagem) conseguia "recuperar" de novo uma duplicata já 'paga',
  // creditando o credor uma segunda vez pelo mesmo valor. Mesmo tratamento (retorna null,
  // a rota já responde 409 'already_recovered') que uma recuperação jurídica repetida.
  if (duplicata.status === 'paga') return null;
  const creditor = currentCreditorFor(duplicata);
  if (!creditor) return null;

  const feePct = getSuccessFeePct();
  const feeValor = Math.round(recoveredValor * (feePct / 100) * 100) / 100;
  const net = recoveredValor - feeValor;

  recordLegalCollectionFee({
    duplicataId: duplicata.id,
    recoveredValor,
    feePct,
    feeValor,
    chargedUserId: creditor.userId,
    chargedRole: creditor.role,
    recordedBy,
  });
  addLedgerEntry(
    creditor.userId,
    new Date().toLocaleDateString('pt-BR'),
    `Recuperação via cobrança jurídica — duplicata ${duplicata.id} (${fmtBRL(recoveredValor)} recuperado, fee de sucesso de ${feePct}% descontada: ${fmtBRL(feeValor)})`,
    net
  );
  // Mesma consistência que lib/aceiteCore.ts's reportPayment já mantém no caminho normal:
  // se o credor for a conta de sistema do Programa Confirming, o ledger interno do próprio
  // fundo (não só a conta pessoal do sistema) também precisa saber que o dinheiro voltou —
  // senão o NAV/cota do fundo ficaria permanentemente inflado por uma posição que já foi
  // recuperada e paga.
  const fundoSistemaUserId = getFundoSistemaUserIdIfExists();
  if (fundoSistemaUserId !== null && creditor.userId === fundoSistemaUserId) {
    fundoRetornoDePagamento(duplicata.id, net);
  }
  setDuplicataStatus(duplicata.id, 'paga');

  return { feeValor, feePct, chargedTo: creditor };
}
