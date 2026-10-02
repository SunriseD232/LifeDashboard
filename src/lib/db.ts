import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { snapshot } from './backup';
import { migrate } from './migrations';

/**
 * Своя база LifeDashboard — один SQLite-файл на сервере, ни с кем не общая.
 *
 * Почему SQLite: данных немного (списки вещей и дела на день), пишет один
 * процесс, а файл легко забэкапить копированием. Путь — LD_DB_PATH (на
 * сервере /opt/lifedashboard/data/lifedashboard.db, вне каталога сборок:
 * релизы меняются, данные остаются), по умолчанию ./data/lifedashboard.db
 * для локального запуска.
 *
 * Схема — в src/lib/migrations.ts: при открытии база доводится до последней
 * версии, а перед миграцией снимается копия (src/lib/backup.ts).
 */

export const DB_PATH = process.env.LD_DB_PATH || path.join(process.cwd(), 'data', 'lifedashboard.db');

declare global {
  // Один экземпляр на процесс: в dev Next перезагружает модули, и без этого
  // открывалось бы по соединению на каждую правку.
  // eslint-disable-next-line no-var
  var __ldDb: Database.Database | undefined;
}

export function db(): Database.Database {
  if (!global.__ldDb) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    const conn = new Database(DB_PATH);
    conn.pragma('journal_mode = WAL');
    conn.pragma('foreign_keys = ON');
    migrate(conn, (from) => {
      // Совсем новая база — копировать нечего. Старая без номера версии
      // (до миграций) узнаётся по таблицам.
      if (from > 0 || conn.prepare("select 1 from sqlite_master where name = 'checklists'").get()) {
        snapshot(conn, `pre-migrate-v${from}`);
      }
    });
    global.__ldDb = conn;
  }
  return global.__ldDb;
}
