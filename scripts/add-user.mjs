#!/usr/bin/env node
/**
 * Завести пользователя LifeDashboard или сменить ему пароль.
 *
 *   node scripts/add-user.mjs <логин> [--adopt]
 *
 * Пароль спрашивается в терминале (или берётся из LD_PASSWORD). Логин уже
 * есть — меняется пароль, а все его сессии сбрасываются.
 *
 * --adopt — новый пользователь получает id «ничейных» данных: тех, что
 * остались со времён входа через MediaWatch. Сработает, только если такой
 * владелец ровно один; иначе скрипт покажет список и ничего не сделает.
 *
 * На сервере:
 *   cd /opt/lifedashboard/current
 *   node --env-file=/opt/lifedashboard/.env scripts/add-user.mjs <логин> --adopt
 *
 * Хэш пароля — в том же формате, что в src/lib/auth.ts.
 */
import Database from 'better-sqlite3';
import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const args = process.argv.slice(2);
const adopt = args.includes('--adopt');
const login = args.find((a) => !a.startsWith('--'))?.trim().toLowerCase();
if (!login || login.length > 64) {
  console.error('Использование: node scripts/add-user.mjs <логин> [--adopt]');
  process.exit(1);
}

const DB_PATH = process.env.LD_DB_PATH || path.join(process.cwd(), 'data', 'lifedashboard.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
// База зашифрована ключом LD_DATA_KEY (как в src/lib/dbKey.ts). Если файл
// ещё открытый — шифруем его тем же способом, что и приложение.
const KEY = process.env.LD_DATA_KEY?.trim();
const cipher = (c) => {
  c.pragma("cipher='sqlcipher'");
  c.pragma('legacy=4');
};
if (KEY && fs.existsSync(DB_PATH) && fs.readFileSync(DB_PATH).subarray(0, 16).toString('binary') === 'SQLite format 3\0') {
  const plain = new Database(DB_PATH);
  plain.pragma('wal_checkpoint(TRUNCATE)');
  plain.pragma('journal_mode = DELETE');
  cipher(plain);
  plain.pragma(`rekey='${KEY}'`);
  plain.close();
}
const db = new Database(DB_PATH);
if (KEY) {
  cipher(db);
  db.pragma(`key='${KEY}'`);
}
db.pragma('foreign_keys = ON');
// Те же таблицы, что в src/lib/db.ts: скрипт может запуститься раньше, чем
// приложение впервые открыло базу.
db.exec(`
create table if not exists users (
  id text primary key,
  login text not null unique,
  password_hash text not null,
  created_at text not null default (datetime('now'))
);
create table if not exists sessions (
  token_hash text primary key,
  user_id text not null references users(id) on delete cascade,
  expires_at text not null,
  created_at text not null default (datetime('now'))
);
create index if not exists sessions_user_idx on sessions (user_id);
`);

function askPassword(prompt) {
  if (process.env.LD_PASSWORD) return Promise.resolve(process.env.LD_PASSWORD);
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    process.stdout.write(prompt);
    // Не показываем вводимые символы.
    rl._writeToOutput = () => {};
    rl.question('', (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

function hashPassword(password) {
  const N = 16384, r = 8, p = 1;
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 64, { N, r, p });
  return ['scrypt', N, r, p, salt.toString('base64'), key.toString('base64')].join('$');
}

/** Владельцы данных, у которых нет записи в users. */
function orphanOwners() {
  const tables = ['checklists', 'reminders', 'push_subscriptions'].filter((t) =>
    db.prepare("select 1 from sqlite_master where type = 'table' and name = ?").get(t),
  );
  if (!tables.length) return [];
  const union = tables.map((t) => `select user_id from ${t}`).join(' union all ');
  return db
    .prepare(
      `select user_id, count(*) as n from (${union}) where user_id not in (select id from users) group by user_id`,
    )
    .all();
}

const existing = db.prepare('select id from users where login = ?').get(login);

let id = existing?.id ?? randomUUID();
if (!existing && adopt) {
  const owners = orphanOwners();
  if (owners.length !== 1) {
    console.error(owners.length ? 'Ничейных владельцев несколько — выберите вручную:' : 'Ничейных данных нет.');
    owners.forEach((o) => console.error(`  ${o.user_id}  (${o.n} строк)`));
    process.exit(1);
  }
  id = owners[0].user_id;
}

const password = await askPassword(existing ? `Новый пароль для ${login}: ` : `Пароль для ${login}: `);
if (password.length < 8) {
  console.error('Пароль — не короче 8 символов.');
  process.exit(1);
}

const hash = hashPassword(password);
if (existing) {
  db.transaction(() => {
    db.prepare('update users set password_hash = ? where id = ?').run(hash, id);
    db.prepare('delete from sessions where user_id = ?').run(id);
  })();
  console.log(`Пароль для ${login} изменён, все сессии сброшены.`);
} else {
  db.prepare('insert into users (id, login, password_hash) values (?, ?, ?)').run(id, login, hash);
  console.log(`Пользователь ${login} создан${adopt ? ' — прежние данные теперь его' : ''}.`);
}
db.close();
