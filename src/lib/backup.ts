import type Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Копии базы. Два вида:
 *  - ночная (daily-ГГГГ-ММ-ДД.db) — раз в сутки, храним KEEP_DAILY последних;
 *  - перед миграцией (pre-migrate-vN-….db) — их не удаляем: они редкие и
 *    нужны ровно тогда, когда что-то пошло не так.
 *
 * Копия снимается через VACUUM INTO: это целостный снимок даже при открытой
 * базе в режиме WAL, в отличие от копирования файла.
 *
 * Каталог — LD_BACKUP_DIR, по умолчанию backups/ рядом с базой (на сервере
 * /opt/lifedashboard/data/backups — вне релизов, как и сама база).
 */

export const KEEP_DAILY = 14;
const DAILY_RE = /^daily-(\d{4}-\d{2}-\d{2})\.db$/;

export function backupDir(): string {
  const dbPath = process.env.LD_DB_PATH || path.join(process.cwd(), 'data', 'lifedashboard.db');
  return process.env.LD_BACKUP_DIR || path.join(path.dirname(dbPath), 'backups');
}

function stamp(d = new Date()): string {
  return d.toISOString().slice(0, 19).replace(/[:T]/g, '-');
}

/** Снимок базы в файл <dir>/<name>-<время>.db. Возвращает путь. */
export function snapshot(conn: Database.Database, name: string, dir = backupDir()): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}-${stamp()}.db`);
  conn.prepare('vacuum into ?').run(file);
  return file;
}

/** Какие ночные копии лишние: всё, кроме `keep` самых свежих. */
export function dailyToDelete(files: string[], keep = KEEP_DAILY): string[] {
  return files
    .filter((f) => DAILY_RE.test(f))
    .sort()
    .reverse()
    .slice(keep);
}

/** Ночная копия за сегодня (UTC), если её ещё нет, и уборка старых. */
export function dailyBackup(conn: Database.Database, dir = backupDir(), now = new Date()): string | null {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `daily-${now.toISOString().slice(0, 10)}.db`);
  let made: string | null = null;
  if (!fs.existsSync(file)) {
    conn.prepare('vacuum into ?').run(file);
    made = file;
  }
  for (const old of dailyToDelete(fs.readdirSync(dir))) fs.rmSync(path.join(dir, old), { force: true });
  return made;
}

declare global {
  // eslint-disable-next-line no-var
  var __ldBackupTimer: ReturnType<typeof setInterval> | undefined;
}

/** Раз в час проверяем, есть ли копия за сегодня (src/instrumentation.ts). */
export function startBackups(getDb: () => Database.Database): void {
  if (global.__ldBackupTimer) return;
  const run = () => {
    try {
      const made = dailyBackup(getDb());
      if (made) console.log('[lifedashboard backup]', made);
    } catch (e) {
      console.error('[lifedashboard backup] не получилось:', e);
    }
  };
  global.__ldBackupTimer = setInterval(run, 60 * 60_000);
  setTimeout(run, 60_000);
}
