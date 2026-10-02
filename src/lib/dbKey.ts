import type Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Шифрование базы целиком (SQLCipher 4 через better-sqlite3-multiple-ciphers,
 * подключён вместо better-sqlite3 под тем же именем — см. package.json).
 *
 * Ключ — LD_DATA_KEY в /opt/lifedashboard/.env. Без него файл базы и каждая
 * копия в backups/ — шум: ни строк, ни названий, ни поиска. Ночные копии
 * (VACUUM INTO) шифруются тем же ключом сами.
 *
 * ВАЖНО: ключ надо хранить ещё где-то, кроме сервера (менеджер паролей).
 * Потерян ключ — базу и все копии не открыть никогда.
 *
 * Нет ключа (локальная разработка, тесты) — база обычная, как раньше.
 */

const HEADER = 'SQLite format 3\0';
const KEY_RE = /^[A-Za-z0-9_-]{32,128}$/;

export function dataKey(): string | null {
  const k = process.env.LD_DATA_KEY?.trim();
  if (!k) return null;
  // Ключ вставляется в PRAGMA — только безопасные символы, и длинный.
  if (!KEY_RE.test(k)) throw new Error('LD_DATA_KEY: нужно 32–128 символов A–Z, a–z, 0–9, «-», «_».');
  return k;
}

/** Обычный (незашифрованный) ли это файл SQLite. Нет файла — false. */
export function isPlainFile(file: string): boolean {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(16);
    fs.readSync(fd, buf, 0, 16, 0);
    fs.closeSync(fd);
    return buf.toString('binary') === HEADER;
  } catch {
    return false;
  }
}

function cipher(conn: Database.Database): void {
  conn.pragma("cipher='sqlcipher'");
  conn.pragma('legacy=4');
}

/** Открыть соединение зашифрованным ключом; неверный ключ — понятная ошибка. */
export function unlock(conn: Database.Database, key: string): void {
  cipher(conn);
  conn.pragma(`key='${key}'`);
  try {
    conn.prepare('select count(*) from sqlite_master').get();
  } catch {
    throw new Error('База не открывается: LD_DATA_KEY не подходит (или файл повреждён).');
  }
}

/**
 * Зашифровать обычный файл на месте. WAL сначала сливаем в файл: шифровать
 * базу в режиме WAL библиотека не умеет.
 */
export function encryptFile(Db: typeof Database, file: string, key: string): void {
  const conn = new Db(file);
  try {
    conn.pragma('wal_checkpoint(TRUNCATE)');
    conn.pragma('journal_mode = DELETE');
    cipher(conn);
    conn.pragma(`rekey='${key}'`);
  } finally {
    conn.close();
  }
  for (const extra of ['-wal', '-shm']) fs.rmSync(file + extra, { force: true });
}

/**
 * Разовый переход на шифрование: сама база и все прежние открытые копии в
 * каталоге копий. Возвращает, сколько файлов зашифровано.
 */
export function encryptExisting(Db: typeof Database, dbFile: string, backupDir: string, key: string): number {
  let n = 0;
  if (isPlainFile(dbFile)) {
    encryptFile(Db, dbFile, key);
    n++;
  }
  if (fs.existsSync(backupDir)) {
    for (const name of fs.readdirSync(backupDir)) {
      const f = path.join(backupDir, name);
      if (name.endsWith('.db') && isPlainFile(f)) {
        encryptFile(Db, f, key);
        n++;
      }
    }
  }
  return n;
}
