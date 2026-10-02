#!/usr/bin/env node
/**
 * Есть ли в базе пользователи (для scripts/deploy.sh). Код выхода 0 — есть.
 * База может быть зашифрована — ключ LD_DATA_KEY из окружения (--env-file).
 */
import Database from 'better-sqlite3';

const db = new Database(process.env.LD_DB_PATH, { readonly: true, fileMustExist: true });
const key = process.env.LD_DATA_KEY?.trim();
if (key) {
  db.pragma("cipher='sqlcipher'");
  db.pragma('legacy=4');
  db.pragma(`key='${key}'`);
}
process.exit(db.prepare('select count(*) n from users').get().n > 0 ? 0 : 1);
