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
  /**
   * Пересборка таблиц (create new → copy → drop → rename): на время шага
   * внешние ключи выключаются, иначе drop старой таблицы каскадом удалил бы
   * строки, которые на неё ссылаются. После шага ключи проверяются.
   */
  rebuild?: boolean;
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
  {
    version: 2,
    name: 'гибкие повторы: правило и несколько времён у напоминания, отметки по времени, «отложить»',
    rebuild: true,
    up: (db) =>
      db.exec(`
    -- Напоминание: вместо repeat/on_date/at_time — правило (src/lib/recur.ts)
    -- JSON-ом и список времён ["09:00","21:00"].
    create table reminders_new (
      id text primary key,
      user_id text not null,
      title text not null,
      times text not null,
      rule text not null,
      checklist_id text references checklists(id) on delete set null,
      created_at text not null default (datetime('now'))
    );
    insert into reminders_new (id, user_id, title, times, rule, checklist_id, created_at)
    select id, user_id, title,
      json_array(substr(at_time, 1, 5)),
      case repeat
        when 'daily' then json_object('kind', 'repeat', 'unit', 'day', 'every', 1, 'start', date(created_at))
        when 'weekdays' then json_object('kind', 'repeat', 'unit', 'week', 'every', 1, 'start', date(created_at),
                                         'weekdays', json('[1,2,3,4,5]'))
        else json_object('kind', 'once', 'date', coalesce(on_date, date(created_at)))
      end,
      checklist_id, created_at
    from reminders;
    drop table reminders;
    alter table reminders_new rename to reminders;
    create index reminders_user_idx on reminders (user_id);

    -- «Сделано» — на день И время (slot 'ЧЧ:ММ'): у «таблеток в 9 и 21» две
    -- отметки в сутки. Старые отметки — на единственное время напоминания.
    create table reminder_done_new (
      reminder_id text not null references reminders(id) on delete cascade,
      user_id text not null,
      day text not null,
      slot text not null,
      primary key (reminder_id, day, slot)
    );
    insert or ignore into reminder_done_new (reminder_id, user_id, day, slot)
    select d.reminder_id, d.user_id, d.day, json_extract(r.times, '$[0]')
    from reminder_done d join reminders r on r.id = d.reminder_id;
    drop table reminder_done;
    alter table reminder_done_new rename to reminder_done;
    create index reminder_done_user_idx on reminder_done (user_id, day);

    -- Отправленные push — тоже по времени; для «отложенных» slot вида
    -- 'ЧЧ:ММ>ЧЧ:ММ' (на какое время отложили).
    create table push_sent_new (
      reminder_id text not null,
      day text not null,
      slot text not null,
      sent_at text not null default (datetime('now')),
      primary key (reminder_id, day, slot)
    );
    insert or ignore into push_sent_new (reminder_id, day, slot, sent_at)
    select p.reminder_id, p.day, coalesce(json_extract(r.times, '$[0]'), ''), p.sent_at
    from push_sent p left join reminders r on r.id = p.reminder_id;
    drop table push_sent;
    alter table push_sent_new rename to push_sent;

    -- «Отложить»: напомнить об этом времени дела ещё раз в at (местное время).
    create table reminder_snooze (
      reminder_id text not null references reminders(id) on delete cascade,
      user_id text not null,
      day text not null,
      slot text not null,
      at text not null,
      primary key (reminder_id, day, slot)
    );
    `),
  },
  {
    version: 3,
    name: 'дела, семья (общие списки), настройки пользователя',
    up: (db) =>
      db.exec(`
    -- Семья — несколько пользователей с общими делами, а дальше покупками и
    -- запасами. Человек состоит не больше чем в одной семье.
    create table households (
      id text primary key,
      name text not null,
      created_by text not null,
      created_at text not null default (datetime('now'))
    );
    create table household_members (
      user_id text primary key references users(id) on delete cascade,
      household_id text not null references households(id) on delete cascade,
      joined_at text not null default (datetime('now'))
    );
    create index household_members_hh_idx on household_members (household_id);

    -- Дела. Без даты — «срочно»; с датой — «позже», а за день до срока
    -- переезжают в «срочно». household_id — общее дело семьи (видят все её
    -- участники), null — личное. rule — повтор (src/lib/recur.ts): выполнили
    -- — срок переезжает на следующий раз, а отметка ложится в task_log.
    create table tasks (
      id text primary key,
      user_id text not null,
      household_id text references households(id) on delete set null,
      title text not null,
      note text,
      tag text,
      due_date text,
      rule text,
      done_at text,
      created_at text not null default (datetime('now'))
    );
    create index tasks_user_idx on tasks (user_id, done_at);
    create index tasks_household_idx on tasks (household_id, done_at);

    -- Кто и когда выполнил: «Сделано сегодня» и история повторяющихся дел.
    -- prev_due — срок до отметки: «отменить» у повторяющегося дела
    -- возвращает его на место.
    create table task_log (
      task_id text not null references tasks(id) on delete cascade,
      user_id text not null,
      day text not null,
      prev_due text,
      created_at text not null default (datetime('now'))
    );
    create index task_log_task_idx on task_log (task_id, day);

    -- Настройки человека: город для погоды, во сколько напоминать о сроках.
    create table user_settings (
      user_id text primary key references users(id) on delete cascade,
      city text,
      lat real,
      lon real,
      deadline_time text not null default '09:00'
    );
    `),
  },
  {
    version: 4,
    name: 'часовой пояс города для погоды',
    up: (db) => db.exec('alter table user_settings add column tz text'),
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
    const fk = db.pragma('foreign_keys', { simple: true }) as number;
    // Выключить ключи можно только вне транзакции.
    if (m.rebuild) db.pragma('foreign_keys = OFF');
    try {
      db.transaction(() => {
        m.up(db);
        if (m.rebuild) {
          const broken = db.pragma('foreign_key_check') as unknown[];
          if (broken.length) throw new Error(`Миграция ${m.version}: нарушены внешние ключи (${broken.length})`);
        }
        // user_version не принимает параметры — только литерал; число наше.
        db.pragma(`user_version = ${m.version}`);
      })();
    } finally {
      if (m.rebuild) db.pragma(`foreign_keys = ${fk ? 'ON' : 'OFF'}`);
    }
  }
  return pending.length;
}
