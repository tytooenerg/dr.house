import { getPlatformSetting, setPlatformSetting } from '../db/platformSettings.js';
import { recordAddOnCharge, hasChargedThisPeriod, type AddOnKind, type AddOnChargeRow } from '../db/addOnCharges.js';
import { addLedgerEntry } from '../db/misc.js';
import { fmtBRL } from './format.js';

// Shared engine behind the 5 new monetization products (see README "Novas linhas de
// receita"): every charge is a real ledger debit plus a real logged row in
// addon_charges, the same "real accounting, simulated money movement" scope as the
// platform fee / insurance commission / legal collection fee already in this codebase —
// nothing here fabricates a number or bypasses the real ledger.

const DEFAULT_PRICES: Record<AddOnKind, number> = {
  api_overage: 0.05, // per call beyond the included monthly quota
  score_api: 1.5, // per consulta via a standalone Score API key
  pld_screening_api: 2.0, // per triagem via a standalone PLD screening API key
  whitelabel_plus: 490, // flat monthly recurring fee
  institutional_reporting: 690, // flat monthly recurring fee
};

const SETTING_PREFIX = 'addon_price_';

export function getAddOnPrice(kind: AddOnKind): number {
  const raw = getPlatformSetting(SETTING_PREFIX + kind);
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : DEFAULT_PRICES[kind];
}

export function setAddOnPrice(kind: AddOnKind, value: number, adminId?: number) {
  setPlatformSetting(SETTING_PREFIX + kind, String(value), adminId);
}

export function getAddOnDefaultPrice(kind: AddOnKind): number {
  return DEFAULT_PRICES[kind];
}

export function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7); // 'YYYY-MM'
}

// Per-call billing (score_api, pld_screening_api) — always charges, no period dedup.
export async function chargePerCall(userId: number, kind: AddOnKind, description: string): Promise<AddOnChargeRow> {
  const unitPrice = getAddOnPrice(kind);
  const row = recordAddOnCharge({ userId, kind, quantity: 1, unitPrice, amount: unitPrice, description });
  addLedgerEntry(userId, new Date().toLocaleDateString('pt-BR'), description, -unitPrice);
  return row;
}

// Monthly recurring/aggregate billing (api_overage, whitelabel_plus,
// institutional_reporting) — charges at most once per user per kind per calendar month.
// Returns null (not an error) if this period was already charged, so callers (a monthly
// cron job or an admin "cobrar agora" action) can call it idempotently.
export async function chargeOncePerPeriod(
  userId: number,
  kind: AddOnKind,
  quantity: number,
  description: string,
  period: string = currentPeriod()
): Promise<AddOnChargeRow | null> {
  if (quantity <= 0) return null;
  if (hasChargedThisPeriod(userId, kind, period)) return null;
  const unitPrice = getAddOnPrice(kind);
  const amount = +(unitPrice * quantity).toFixed(2);
  const row = recordAddOnCharge({ userId, kind, period, quantity, unitPrice, amount, description });
  addLedgerEntry(userId, new Date().toLocaleDateString('pt-BR'), description, -amount);
  return row;
}

export function fmtAddOnPrice(kind: AddOnKind): string {
  return fmtBRL(getAddOnPrice(kind));
}
