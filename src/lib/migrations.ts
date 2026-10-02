import type Database from 'better-sqlite3';

/**
 * Миграции базы — нумерованные шаги, номер применённой хранится в самой базе
 * (PRAGMA user_version). db() при открытии прогоняет недостающие по порядку,
 * каждую в своей транзакции; перед первой из них снимает копию файла
 * (src/lib/backup.ts) — откатиться можно, просто вернув её.
 *
 * Правила: опубликованную миграцию НЕ МЕНЯТЬ — только добавлять следующую.
 * Шаг 1 — схема, какой она была до миграций: в старых базах таблицы уже есть,
 * поэтому всё в нём «if not exists».
 */

export interface Migration {
  version: number;
  name: string;
  up: (db: Database.Database) => void;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'исходная схема: пользователи, чек-листы, напоминания, push',
    up: (db) =>
      db.exec(`
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
    `),
  },
];

export const LATEST = MIGRATIONS[MIGRATIONS.length - 1].version;

export function schemaVersion(db: Database.Database): number {
  return db.pragma('user_version', { simple: true }) as number;
}

/** Применить недостающие миграции. Возвращает, сколько применено. */
export function migrate(db: Database.Database, beforeFirst?: (from: number) => void): number {
  const from = schemaVersion(db);
  const pending = MIGRATIONS.filter((m) => m.version > from);
  if (pending.length && beforeFirst) beforeFirst(from);
  for (const m of pending) {
    db.transaction(() => {
      m.up(db);
      // user_version не принимает параметры — только литерал; число наше.
      db.pragma(`user_version = ${m.version}`);
    })();
  }
  return pending.length;
}
