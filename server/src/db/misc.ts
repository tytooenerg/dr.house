import { db } from './index.js';

// --- notifications ---
export function addNotification(userId: number, text: string, color: string) {
  db.prepare('INSERT INTO notifications (user_id, text, color) VALUES (?, ?, ?)').run(userId, text, color);
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
export function listTeam(ownerId: number) {
  return db.prepare('SELECT * FROM team_members WHERE owner_id = ? ORDER BY id ASC').all(ownerId) as {
    id: number;
    nome: string;
    email: string;
    papel: string;
  }[];
}

export function inviteTeamMember(ownerId: number, nome: string, email: string) {
  db.prepare('INSERT INTO team_members (owner_id, nome, email, papel) VALUES (?, ?, ?, ?)').run(ownerId, nome, email, 'Somente leitura');
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
