import crypto from 'node:crypto';
import { db } from './index.js';
import { defaultSettings, type Plan, type Role, type SubscriptionStatus, type UserRow, type UserSettings } from './types.js';

export function getUserById(id: number): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
}

export function getUserByEmail(email: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim()) as UserRow | undefined;
}

export function createUser(input: { email: string; passwordHash: string; nome: string; companyName: string; role: Role; insurerKey?: string }): UserRow {
  const info = db
    .prepare('INSERT INTO users (email, password_hash, nome, company_name, role, insurer_key, settings) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(
      input.email.toLowerCase().trim(),
      input.passwordHash,
      input.nome,
      input.companyName,
      input.role,
      input.insurerKey ?? null,
      JSON.stringify(defaultSettings())
    );
  return getUserById(Number(info.lastInsertRowid))!;
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

export function updateKybForm(userId: number, field: 'cnpj' | 'tipo' | 'pl', value: string) {
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
