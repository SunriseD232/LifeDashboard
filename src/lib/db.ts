import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Своя база LifeDashboard — один SQLite-файл на сервере, ни с кем не общая.
 *
 * Почему SQLite: данных немного (списки вещей и дела на день), пишет один
 * процесс, а файл легко забэкапить копированием. Путь — LD_DB_PATH (на
 * сервере /opt/lifedashboard/data/lifedashboard.db, вне каталога сборок:
 * релизы меняются, данные остаются), по умолчанию ./data/lifedashboard.db
 * для локального запуска.
 *
 * Схема создаётся при первом обращении (CREATE ... IF NOT EXISTS) — отдельного
 * шага миграции нет. Новые колонки добавлять так же, идемпотентно.
 */

const DB_PATH = process.env.LD_DB_PATH || path.join(process.cwd(), 'data', 'lifedashboard.db');

const SCHEMA = `
-- Пользователи и сессии (src/lib/auth.ts). id — строка: у тех, кто перешёл
-- со входа через MediaWatch, это прежний id, и их данные остались при них.
-- Эти две таблицы повторены в scripts/add-user.mjs — меняйте вместе.
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

-- Push-подписки устройств (Web Push). tz — часовой пояс устройства (IANA):
-- время напоминаний — местное, и сервер должен знать, когда у человека 18:00.
create table if not exists push_subscriptions (
  endpoint text primary key,
  user_id text not null,
  p256dh text not null,
  auth text not null,
  tz text not null default 'Europe/Moscow',
  updated_at text not null default (datetime('now'))
);
create index if not exists push_subscriptions_user_idx on push_subscriptions (user_id);

-- Что уже отправили: одно уведомление на напоминание в сутки, даже если
-- рассылка проходит по нему несколько раз (перезапуск, окно в 10 минут).
create table if not exists push_sent (
  reminder_id text not null,
  day text not null,
  sent_at text not null default (datetime('now')),
  primary key (reminder_id, day)
);
`;

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
    conn.exec(SCHEMA);
    global.__ldDb = conn;
  }
  return global.__ldDb;
}
