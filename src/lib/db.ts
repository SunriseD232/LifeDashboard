import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Своя база «Сборов» — один SQLite-файл на сервере, отдельно от MediaWatch.
 *
 * Почему SQLite: данных немного (списки вещей и дела на день), пишет один
 * процесс, а файл легко забэкапить копированием. Путь — SBORY_DB_PATH (на
 * сервере /opt/sbory/data/sbory.db, вне каталога сборок: релизы меняются,
 * данные остаются), по умолчанию ./data/sbory.db для локального запуска.
 *
 * Схема создаётся при первом обращении (CREATE ... IF NOT EXISTS) — отдельного
 * шага миграции нет. Новые колонки добавлять так же, идемпотентно.
 */

const DB_PATH = process.env.SBORY_DB_PATH || path.join(process.cwd(), 'data', 'sbory.db');

const SCHEMA = `
create table if not exists checklists (
  id text primary key,
  user_id text not null,
  title text not null,
  icon text not null default 'bag',
  position integer not null default 0,
  created_at text not null default (datetime('now'))
);
create index if not exists checklists_user_idx on checklists (user_id, position);

create table if not exists checklist_items (
  id text primary key,
  checklist_id text not null references checklists(id) on delete cascade,
  user_id text not null,
  title text not null,
  group_name text,
  note text,
  done integer not null default 0,
  position integer not null default 0,
  created_at text not null default (datetime('now'))
);
create index if not exists checklist_items_list_idx on checklist_items (checklist_id, position);

create table if not exists reminders (
  id text primary key,
  user_id text not null,
  title text not null,
  at_time text not null,
  repeat text not null default 'once' check (repeat in ('once', 'daily', 'weekdays')),
  on_date text,
  checklist_id text references checklists(id) on delete set null,
  created_at text not null default (datetime('now'))
);
create index if not exists reminders_user_idx on reminders (user_id, at_time);

-- «Сделано» — на конкретный день: у повторяющихся дел отметка своя каждые сутки.
create table if not exists reminder_done (
  reminder_id text not null references reminders(id) on delete cascade,
  user_id text not null,
  day text not null,
  primary key (reminder_id, day)
);
`;

declare global {
  // Один экземпляр на процесс: в dev Next перезагружает модули, и без этого
  // открывалось бы по соединению на каждую правку.
  // eslint-disable-next-line no-var
  var __sboryDb: Database.Database | undefined;
}

export function db(): Database.Database {
  if (!global.__sboryDb) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    const conn = new Database(DB_PATH);
    conn.pragma('journal_mode = WAL');
    conn.pragma('foreign_keys = ON');
    conn.exec(SCHEMA);
    global.__sboryDb = conn;
  }
  return global.__sboryDb;
}
