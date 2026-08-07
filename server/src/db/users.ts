import crypto from 'node:crypto';
import { db } from './index.js';
import { defaultSettings, type Plan, type Role, type SubscriptionStatus, type UserRow, type UserSettings } from './types.js';

export function getUserById(id: number): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
}

export function getUserByEmail(email: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim()) as UserRow | undefined;
}

export function getUserByReferralCode(code: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE referral_code = ?').get(code.toUpperCase().trim()) as UserRow | undefined;
}

export function getUserByGoogleSub(googleSub: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE google_sub = ?').get(googleSub) as UserRow | undefined;
}

export function linkGoogleAccount(userId: number, googleSub: string) {
  db.prepare('UPDATE users SET google_sub = ? WHERE id = ?').run(googleSub, userId);
}

// Add-on subscriptions (features 4/5 — lib/whitelabelBilling.ts, lib/institutionalReporting.ts)
// tracked directly on the user row, independent of the plan (Básico/Pro/Empresarial).
export function setWhitelabelPlusEnabled(userId: number, enabled: boolean) {
  db.prepare('UPDATE users SET whitelabel_plus_enabled = ? WHERE id = ?').run(enabled ? 1 : 0, userId);
}

export function setInstitutionalReportingEnabled(userId: number, enabled: boolean) {
  db.prepare('UPDATE users SET institutional_reporting_enabled = ? WHERE id = ?').run(enabled ? 1 : 0, userId);
}

export function listUsersWithWhitelabelPlus(): UserRow[] {
  return db.prepare('SELECT * FROM users WHERE whitelabel_plus_enabled = 1 AND deleted_at IS NULL').all() as UserRow[];
}

export function listUsersWithInstitutionalReporting(): UserRow[] {
  return db.prepare('SELECT * FROM users WHERE institutional_reporting_enabled = 1 AND deleted_at IS NULL').all() as UserRow[];
}

export function getSeguradoraByInsurerKey(insurerKey: string): UserRow | undefined {
  return db.prepare("SELECT * FROM users WHERE role = 'seguradora' AND insurer_key = ? ORDER BY id ASC LIMIT 1").get(insurerKey) as UserRow | undefined;
}

function generateReferralCode(): string {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

function uniqueReferralCode(): string {
  let code = generateReferralCode();
  for (let attempts = 0; attempts < 5 && getUserByReferralCode(code); attempts++) code = generateReferralCode();
  return code;
}

// Rewards the referrer with one extra monthly emission (see BASICO_MONTHLY_EMIT_LIMIT)
// the moment their referral completes registration — simple, immediate, no billing wiring needed.
function bumpReferralBonus(userId: number) {
  db.prepare('UPDATE users SET referral_bonus_emissions = referral_bonus_emissions + 1 WHERE id = ?').run(userId);
}

export function listReferrals(userId: number): { nome: string; companyName: string; role: Role; createdAt: string }[] {
  return db
    .prepare('SELECT nome, company_name as companyName, role, created_at as createdAt FROM users WHERE referred_by_user_id = ? ORDER BY created_at DESC')
    .all(userId) as { nome: string; companyName: string; role: Role; createdAt: string }[];
}

export function createUser(input: {
  email: string;
  passwordHash: string;
  nome: string;
  companyName: string;
  role: Role;
  insurerKey?: string;
  referredByCode?: string;
  teamOwnerId?: number;
  googleSub?: string;
}): UserRow {
  const referrer = input.referredByCode ? getUserByReferralCode(input.referredByCode) : undefined;
  const info = db
    .prepare(
      'INSERT INTO users (email, password_hash, nome, company_name, role, insurer_key, settings, referral_code, referred_by_user_id, team_owner_id, google_sub, auth_provider) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      input.email.toLowerCase().trim(),
      input.passwordHash,
      input.nome,
      input.companyName,
      input.role,
      input.insurerKey ?? null,
      JSON.stringify(defaultSettings()),
      uniqueReferralCode(),
      referrer?.id ?? null,
      input.teamOwnerId ?? null,
      input.googleSub ?? null,
      input.googleSub ? 'google' : 'password'
    );
  if (referrer) bumpReferralBonus(referrer.id);
  return getUserById(Number(info.lastInsertRowid))!;
}

// A team member account (users.team_owner_id set) has no business data of its own — every
// read that should show "your operations" needs to resolve to the owner's id instead.
// Regular accounts (team_owner_id null) are unaffected. See also auth/middleware.ts,
// which enforces that team member accounts can only ever read, never write, that data.
export function effectiveOwnerId(user: UserRow): number {
  return user.team_owner_id ?? user.id;
}

export function getSettings(user: UserRow): UserSettings {
  try {
    return { ...defaultSettings(), ...JSON.parse(user.settings) };
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(userId: number, settings: UserSettings) {
  db.prepare('UPDATE users SET settings = ? WHERE id = ?').run(JSON.stringify(settings), userId);
}

export function updateSettings(userId: number, patch: Partial<UserSettings>) {
  const user = getUserById(userId)!;
  const merged = { ...getSettings(user), ...patch };
  saveSettings(userId, merged);
  return merged;
}

export function updateProfile(userId: number, patch: { nome?: string; telefone?: string; email?: string }) {
  const user = getUserById(userId)!;
  db.prepare('UPDATE users SET nome = ?, telefone = ?, email = ? WHERE id = ?').run(
    patch.nome ?? user.nome,
    patch.telefone ?? user.telefone,
    (patch.email ?? user.email).toLowerCase().trim(),
    userId
  );
  return getUserById(userId)!;
}

// LGPD right-to-erasure: scrubs personal identifiers (email/nome/telefone/password) and
// marks the account deleted, but keeps the row and its id so financial/audit records that
// reference it (duplicatas, audit_log, etc.) stay intact for legal/compliance retention.
export function anonymizeUser(userId: number) {
  db.prepare(
    `UPDATE users SET email = ?, nome = 'Usuário removido', telefone = '', password_hash = ?, deleted_at = datetime('now') WHERE id = ?`
  ).run(`deleted-user-${userId}@lastro.invalid`, crypto.randomBytes(32).toString('hex'), userId);
}

export function updateKybForm(
  userId: number,
  field: 'cnpj' | 'tipo' | 'pl' | 'naoResidente' | 'paisDomicilio' | 'taxIdEstrangeiro' | 'representanteLegal',
  value: string
) {
  const user = getUserById(userId)!;
  const form = JSON.parse(user.kyb_form || '{}');
  form[field] = value;
  db.prepare('UPDATE users SET kyb_form = ? WHERE id = ?').run(JSON.stringify(form), userId);
  return form;
}

export function markKybDone(userId: number) {
  db.prepare('UPDATE users SET kyb_done = 1 WHERE id = ?').run(userId);
}

export function submitKybForReview(userId: number) {
  db.prepare("UPDATE users SET kyb_status = 'pending', kyb_reject_reason = '' WHERE id = ?").run(userId);
}

export function approveKyb(userId: number) {
  db.prepare("UPDATE users SET kyb_status = 'approved', kyb_done = 1, kyb_reject_reason = '' WHERE id = ?").run(userId);
}

export function rejectKyb(userId: number, reason: string) {
  db.prepare("UPDATE users SET kyb_status = 'rejected', kyb_done = 0, kyb_reject_reason = ? WHERE id = ?").run(reason, userId);
}

export function listPendingKyb(): UserRow[] {
  return db.prepare("SELECT * FROM users WHERE role = 'investidor' AND kyb_status = 'pending' ORDER BY created_at ASC").all() as UserRow[];
}

// Feeds lib/autoEmitJob.ts — every cedente account is a candidate; the job itself checks
// each one's settings.autoEmitEnabled (JSON, not a column) to decide who actually opted in.
export function listActiveCedentes(): UserRow[] {
  return db.prepare("SELECT * FROM users WHERE role = 'cedente' AND deleted_at IS NULL").all() as UserRow[];
}

export function setPldStatus(userId: number, status: 'clear' | 'flagged', note: string) {
  db.prepare('UPDATE users SET pld_status = ?, pld_match_note = ? WHERE id = ?').run(status, note, userId);
}

// --- billing ---
export function getUserByStripeCustomerId(customerId: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE stripe_customer_id = ?').get(customerId) as UserRow | undefined;
}

export function setStripeCustomerId(userId: number, customerId: string) {
  db.prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ?').run(customerId, userId);
}

export function updateSubscription(
  userId: number,
  patch: { plan?: Plan; subscriptionStatus?: SubscriptionStatus; stripeSubscriptionId?: string | null; currentPeriodEnd?: string | null }
) {
  const user = getUserById(userId)!;
  db.prepare('UPDATE users SET plan = ?, subscription_status = ?, stripe_subscription_id = ?, plan_current_period_end = ? WHERE id = ?').run(
    patch.plan ?? user.plan,
    patch.subscriptionStatus ?? user.subscription_status,
    patch.stripeSubscriptionId !== undefined ? patch.stripeSubscriptionId : user.stripe_subscription_id,
    patch.currentPeriodEnd !== undefined ? patch.currentPeriodEnd : user.plan_current_period_end,
    userId
  );
  return getUserById(userId)!;
}
