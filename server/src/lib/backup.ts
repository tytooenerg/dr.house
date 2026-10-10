import fs from 'node:fs';
import path from 'node:path';
import { db, dbPath, dataDirPath } from '../db/index.js';
import { logger } from './logger.js';
import { getOffsiteStatus, syncOffsite, type OffsiteStatus } from './offsiteStorage.js';
import { uploadDir } from '../routes/uploads.js';

// Real, periodic disaster-recovery backups of the SQLite datastore — every dollar/status
// this platform tracks (saldo, duplicatas, ledger, KYB, audit log) lives in this one file,
// and until this module existed there was no automated way to recover it if the
// container/disk were lost. Uses better-sqlite3's native `.backup()` (SQLite's official
// "Online Backup API"), which is safe to run against a live WAL-mode database without
// locking out concurrent writers — not a naive `cp` of a file that might be mid-write.
//
// Off-site: com BACKUP_S3_* no .env, cada snapshot e todo documento enviado ainda não copiado
// vão para um armazenamento compatível com S3 (lib/offsiteStorage.ts). Sem isso, os backups
// ficam só neste disco — e o painel diz isso. BACKUP_OFFSITE_CMD continua como gancho
// alternativo (`aws s3 cp`/`rclone`/etc.) para quem já tem essa ferramenta no host.

export const backupsDir = path.join(dataDirPath, 'backups');
// Fora do padrão *.db de listBackups(), então a retenção nunca o apaga.
const offsiteStateFile = path.join(backupsDir, '.offsite-state.json');

// In-memory test databases (DB_PATH=':memory:') have nothing on disk to back up — this is
// the expected, honest state during `npm test`, not a misconfiguration.
export const backupEnabled = dbPath !== ':memory:';

if (backupEnabled) {
  if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });
  logger.info({ backupsDir }, '[backup] backups automáticos do SQLite habilitados');
} else {
  logger.info('[backup] DB_PATH=:memory: — backups desabilitados (nada em disco para copiar)');
}

function timestampedFilename(): string {
  const iso = new Date().toISOString().replace(/[:.]/g, '-');
  return `lastro-${iso}.db`;
}

export interface BackupInfo {
  filename: string;
  sizeBytes: number;
  createdAt: string;
}

export async function runBackup(): Promise<BackupInfo | null> {
  if (!backupEnabled) return null;
  const filename = timestampedFilename();
  const dest = path.join(backupsDir, filename);
  await db.backup(dest);
  const stat = fs.statSync(dest);
  logger.info({ filename, sizeBytes: stat.size }, '[backup] snapshot criado');

  const offsiteCmd = process.env.BACKUP_OFFSITE_CMD;
  if (offsiteCmd) {
    try {
      const { execFile } = await import('node:child_process');
      execFile(offsiteCmd, [dest], (err) => {
        if (err) logger.warn({ err }, '[backup] BACKUP_OFFSITE_CMD falhou');
        else logger.info({ dest }, '[backup] cópia off-site enviada');
      });
    } catch (err) {
      logger.warn({ err }, '[backup] falha ao disparar BACKUP_OFFSITE_CMD');
    }
  }

  await syncOffsite({ snapshotPath: dest, uploadsDir: uploadDir, stateFile: offsiteStateFile });

  applyRetention();
  return { filename, sizeBytes: stat.size, createdAt: new Date().toISOString() };
}

export function offsiteStatus(): OffsiteStatus {
  return getOffsiteStatus(offsiteStateFile, uploadDir);
}

export function listBackups(): BackupInfo[] {
  if (!backupEnabled || !fs.existsSync(backupsDir)) return [];
  return fs
    .readdirSync(backupsDir)
    .filter((f) => f.endsWith('.db'))
    .map((filename) => {
      const stat = fs.statSync(path.join(backupsDir, filename));
      return { filename, sizeBytes: stat.size, createdAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function getRetentionCount(): number {
  const raw = process.env.BACKUP_RETENTION_COUNT;
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 28; // default: ~1 week of backups at the default 6h cadence
}

function applyRetention() {
  const keep = getRetentionCount();
  const backups = listBackups();
  const stale = backups.slice(keep);
  for (const b of stale) {
    try {
      fs.unlinkSync(path.join(backupsDir, b.filename));
    } catch (err) {
      logger.warn({ err, filename: b.filename }, '[backup] falha ao remover backup antigo');
    }
  }
  if (stale.length) logger.info({ removed: stale.length, kept: keep }, '[backup] retenção aplicada');
}

// Only started from src/index.ts (never during tests/importing app.ts), same pattern as
// startHealthMonitor/startAceiteReminderJob/startAutoEmitJob.
export function startBackupJob(intervalMs?: number): NodeJS.Timeout | null {
  if (!backupEnabled) return null;
  const interval = intervalMs ?? (process.env.BACKUP_INTERVAL_MS ? parseInt(process.env.BACKUP_INTERVAL_MS, 10) : 6 * 60 * 60 * 1000);
  const run = () => {
    runBackup().catch((err) => logger.error({ err }, '[backup] falha ao criar snapshot'));
  };
  run();
  return setInterval(run, interval);
}
