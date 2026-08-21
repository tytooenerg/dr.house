import { describe, expect, it, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';
import { backupEnabled, listBackups, runBackup } from '../src/lib/backup.js';

describe('backup module — behavior under the test env (DB_PATH=:memory:)', () => {
  it('is honestly disabled when there is nothing on disk to copy', () => {
    expect(backupEnabled).toBe(false);
  });

  it('runBackup() is a safe no-op, not a fabricated success', async () => {
    expect(await runBackup()).toBeNull();
  });

  it('listBackups() returns an empty list rather than throwing', () => {
    expect(listBackups()).toEqual([]);
  });
});

describe("SQLite's online backup API (the mechanism runBackup() relies on)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lastro-backup-test-'));
  const srcPath = path.join(dir, 'source.db');
  const destPath = path.join(dir, 'snapshot.db');

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('produces a fully independent, readable copy of a live WAL-mode database', async () => {
    const src = new Database(srcPath);
    src.pragma('journal_mode = WAL');
    src.exec('CREATE TABLE saldo (id INTEGER PRIMARY KEY, valor REAL)');
    src.prepare('INSERT INTO saldo (valor) VALUES (?)').run(1000);

    await src.backup(destPath);

    const copy = new Database(destPath, { readonly: true });
    const row = copy.prepare('SELECT valor FROM saldo WHERE id = 1').get() as { valor: number };
    expect(row.valor).toBe(1000);
    copy.close();

    // The copy is independent: writes to the source after the backup don't leak into it.
    src.prepare('INSERT INTO saldo (valor) VALUES (?)').run(2000);
    const copy2 = new Database(destPath, { readonly: true });
    const count = copy2.prepare('SELECT COUNT(*) as n FROM saldo').get() as { n: number };
    expect(count.n).toBe(1);
    copy2.close();
    src.close();
  });
});
