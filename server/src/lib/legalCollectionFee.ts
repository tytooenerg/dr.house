import { addLedgerEntry } from '../db/misc.js';
import { getActivePurchaseByDuplicata } from '../db/resaleListings.js';
import { setStatus as setDuplicataStatus } from '../db/duplicatas.js';
import { getFloatSetting, setPlatformSetting } from '../db/platformSettings.js';
import { recordLegalCollectionFee, hasFeeAlreadyCharged } from '../db/legalCollectionFees.js';
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

// Charges the fee against whoever currently holds the receivable and marks the duplicata
// 'paga' — the natural real use for that status (previously only present in static demo
// seed data, never set by any real flow). Only ever charged once per duplicata. The
// recovery itself (the sacado's actual payment, off-platform) isn't processed here — only
// Lastro's own fee for having assisted the escalation is, same honest scope as the rest
// of the settlement layer (see lib/settlement.ts).
export function recordRecovery(duplicata: DuplicataRow, recoveredValor: number, recordedBy?: number): RecordRecoveryResult | null {
  if (hasFeeAlreadyCharged(duplicata.id)) return null;
  const creditor = currentCreditorFor(duplicata);
  if (!creditor) return null;

  const feePct = getSuccessFeePct();
  const feeValor = Math.round(recoveredValor * (feePct / 100) * 100) / 100;

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
    `Fee de sucesso — cobrança jurídica de ${duplicata.id} (${feePct}% sobre ${fmtBRL(recoveredValor)} recuperado)`,
    -feeValor
  );
  setDuplicataStatus(duplicata.id, 'paga');

  return { feeValor, feePct, chargedTo: creditor };
}
