import crypto from 'node:crypto';
import { db } from './index.js';
import { getSettings, getUserById } from './users.js';
import { sendEmail } from '../lib/mailer.js';
import { sendWhatsapp } from '../lib/smsNotifier.js';
import { sendWebPush } from '../lib/webPush.js';
import { logger } from '../lib/logger.js';

// --- notifications ---
// `category` is optional — pass it only for real events the user can toggle in
// Perfil (leilão/aceite/disputa); seed/demo notifications skip it so they never trigger email.
export function addNotification(userId: number, text: string, color: string, category?: 'leilao' | 'aceite' | 'disputa') {
  db.prepare('INSERT INTO notifications (user_id, text, color) VALUES (?, ?, ?)').run(userId, text, color);
  if (!category) return;
  const user = getUserById(userId);
  if (!user) return;
  const settings = getSettings(user);
  if (settings.notifPrefs[category]) sendEmail(user.email, 'Lastro — nova atualização na sua conta', text);
  if (settings.notifyViaWhatsapp && user.telefone) {
    sendWhatsapp(user.telefone, `Lastro: ${text}`).catch((err) => logger.warn({ err, userId }, '[whatsapp] falha ao notificar'));
  }
  // Real Web Push (lib/webPush.ts) — fires for every real, categorized in-app notification,
  // same choke point email/WhatsApp already use, so every existing call site across the app
  // gets it automatically. A no-op with no subscribed device (sendWebPush's own early
  // return), so this is silent for the vast majority of users who never opted in.
  sendWebPush(userId, { title: 'Lastro', body: text }).catch((err) => logger.warn({ err, userId }, '[web-push] falha ao notificar'));
}

// Fan-out to every admin account — used by background jobs (the cobrança agent scan, the
// onboarding pre-triage) that create something an admin needs to look at but have no
// single "owner" to notify the way a normal user-triggered event does. No category, so it
// never fires email/WhatsApp on its own — an admin sees it in the in-app bell, same as
// checking the Agentes IA pending queue directly.
export function notifyAdmins(text: string, color: string) {
  const admins = db.prepare("SELECT id FROM users WHERE role = 'admin' AND deleted_at IS NULL").all() as { id: number }[];
  for (const a of admins) addNotification(a.id, text, color);
}

export function listNotifications(userId: number, limit = 20) {
  return db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?').all(userId, limit) as {
    id: number;
    text: string;
    color: string;
    read: number;
    created_at: string;
  }[];
}

export function markNotificationsRead(userId: number) {
  db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(userId);
}

export function hasUnread(userId: number): boolean {
  const row = db.prepare('SELECT COUNT(*) as n FROM notifications WHERE user_id = ? AND read = 0').get(userId) as { n: number };
  return row.n > 0;
}

// --- team members ---
// Real invite flow: a random token is generated here, only its SHA-256 hash is ever
// stored (mirrors how refresh tokens are stored — see auth/jwt.ts hashRefreshToken), and
// the raw token is returned once to the caller so it can be emailed/shown, never
// persisted in cleartext. Accepting the invite (auth.ts POST /team-invite/accept) creates
// a real login-capable account with users.team_owner_id = ownerId, and the platform
// enforces read-only access for those accounts centrally (auth/middleware.ts).
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function hashInviteToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export interface TeamMemberRow {
  id: number;
  owner_id: number;
  nome: string;
  email: string;
  papel: string;
  status: 'pending' | 'active' | 'revoked';
  invite_token_hash: string | null;
  invite_expires_at: string | null;
  user_id: number | null;
  accepted_at: string | null;
  created_at: string;
}

export function listTeam(ownerId: number) {
  return db.prepare('SELECT id, nome, email, papel, status, created_at FROM team_members WHERE owner_id = ? ORDER BY id ASC').all(ownerId) as {
    id: number;
    nome: string;
    email: string;
    papel: string;
    status: 'pending' | 'active' | 'revoked';
    created_at: string;
  }[];
}

export function inviteTeamMember(ownerId: number, nome: string, email: string): { id: number; token: string } {
  const token = crypto.randomBytes(24).toString('hex');
  const tokenHash = hashInviteToken(token);
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();
  const info = db
    .prepare(
      `INSERT INTO team_members (owner_id, nome, email, papel, status, invite_token_hash, invite_expires_at)
       VALUES (?, ?, ?, 'Somente leitura', 'pending', ?, ?)`
    )
    .run(ownerId, nome, email, tokenHash, expiresAt);
  return { id: Number(info.lastInsertRowid), token };
}

export function findTeamInviteByToken(token: string): TeamMemberRow | undefined {
  return db.prepare('SELECT * FROM team_members WHERE invite_token_hash = ? AND status = ?').get(hashInviteToken(token), 'pending') as
    | TeamMemberRow
    | undefined;
}

export function acceptTeamInvite(inviteId: number, userId: number) {
  db.prepare("UPDATE team_members SET status = 'active', user_id = ?, accepted_at = datetime('now') WHERE id = ?").run(userId, inviteId);
}

export function revokeTeamMember(ownerId: number, memberId: number) {
  db.prepare("UPDATE team_members SET status = 'revoked' WHERE id = ? AND owner_id = ?").run(memberId, ownerId);
}

// Checked on every request from a team-member account (auth/middleware.ts) so a revoked
// invite locks the account out immediately, not just once its current access token
// happens to expire.
export function isTeamMembershipRevoked(userId: number): boolean {
  const row = db.prepare("SELECT 1 FROM team_members WHERE user_id = ? AND status = 'revoked'").get(userId);
  return !!row;
}

// --- ledger ---
export function addLedgerEntry(userId: number, data: string, descricao: string, valor: number) {
  db.prepare('INSERT INTO ledger (user_id, data, descricao, valor) VALUES (?, ?, ?, ?)').run(userId, data, descricao, valor);
}

export function listLedger(userId: number) {
  return db.prepare('SELECT * FROM ledger WHERE user_id = ? ORDER BY created_at DESC, id DESC').all(userId) as {
    id: number;
    data: string;
    descricao: string;
    valor: number;
    created_at: string;
  }[];
}

// --- api logs ---
export function addApiLog(userId: number, status: string, method: string, path: string) {
  db.prepare('INSERT INTO api_logs (user_id, status, method, path) VALUES (?, ?, ?, ?)').run(userId, status, method, path);
  db.prepare(
    `DELETE FROM api_logs WHERE user_id = ? AND id NOT IN (
       SELECT id FROM api_logs WHERE user_id = ? ORDER BY id DESC LIMIT 6
     )`
  ).run(userId, userId);
}

export function listApiLogs(userId: number) {
  return db.prepare('SELECT * FROM api_logs WHERE user_id = ? ORDER BY id DESC LIMIT 6').all(userId) as {
    id: number;
    status: string;
    method: string;
    path: string;
    created_at: string;
  }[];
}

// --- automation activity ---
export function addAutomationActivity(userId: number, text: string, color: string) {
  db.prepare('INSERT INTO automation_activity (user_id, text, color) VALUES (?, ?, ?)').run(userId, text, color);
  db.prepare(
    `DELETE FROM automation_activity WHERE user_id = ? AND id NOT IN (
       SELECT id FROM automation_activity WHERE user_id = ? ORDER BY id DESC LIMIT 8
     )`
  ).run(userId, userId);
}

export function listAutomationActivity(userId: number) {
  return db.prepare('SELECT * FROM automation_activity WHERE user_id = ? ORDER BY id DESC LIMIT 8').all(userId) as {
    id: number;
    text: string;
    color: string;
    created_at: string;
  }[];
}

// --- uploads ---
export function addUpload(userId: number, kind: string, filename: string, filepath: string) {
  const info = db.prepare('INSERT INTO uploads (user_id, kind, filename, path) VALUES (?, ?, ?, ?)').run(userId, kind, filename, filepath);
  return db.prepare('SELECT * FROM uploads WHERE id = ?').get(Number(info.lastInsertRowid)) as {
    id: number;
    kind: string;
    filename: string;
    path: string;
    created_at: string;
  };
}
