import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { guessDept, SEED_PRODUCTS } from './kitchenSeed';

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
  {
    version: 5,
    name: 'заметки и полнотекстовый поиск',
    up: (db) =>
      db.exec(`
    -- Заметки: заголовок, текст, метки (JSON-массив), закрепление; общие —
    -- для семьи, как дела. checklist_id — заметка к чек-листу.
    create table notes (
      id text primary key,
      user_id text not null,
      household_id text references households(id) on delete set null,
      title text not null default '',
      body text not null default '',
      tags text not null default '[]',
      pinned integer not null default 0,
      checklist_id text references checklists(id) on delete set null,
      created_at text not null default (datetime('now')),
      updated_at text not null default (datetime('now'))
    );
    create index notes_user_idx on notes (user_id, updated_at);
    create index notes_household_idx on notes (household_id);

    -- Быстрый поиск (Ctrl K): полнотекстовый индекс по делам, заметкам,
    -- чек-листам, их пунктам и напоминаниям. Его ведут триггеры ниже —
    -- код приложения о нём не думает. Текст в индексе — с «е» вместо «ё»
    -- (так же нормализуется запрос, src/server/api/search.ts): токенизатор
    -- unicode61 их не сводит. Новый раздел — свои триггеры и заполнение.
    create virtual table search_fts using fts5(
      title, body,
      kind unindexed, ref_id unindexed, user_id unindexed, household_id unindexed,
      tokenize = 'unicode61 remove_diacritics 2'
    );
    create trigger notes_search_ai after insert on notes begin
      insert into search_fts (kind, ref_id, user_id, household_id, title, body) values ('note', new.id, new.user_id, new.household_id, replace(replace(coalesce(new.title, ''), 'ё', 'е'), 'Ё', 'Е'), replace(replace(coalesce(new.body, ''), 'ё', 'е'), 'Ё', 'Е'));
    end;
    create trigger notes_search_au after update on notes begin
      delete from search_fts where kind = 'note' and ref_id = old.id;
      insert into search_fts (kind, ref_id, user_id, household_id, title, body) values ('note', new.id, new.user_id, new.household_id, replace(replace(coalesce(new.title, ''), 'ё', 'е'), 'Ё', 'Е'), replace(replace(coalesce(new.body, ''), 'ё', 'е'), 'Ё', 'Е'));
    end;
    create trigger notes_search_ad after delete on notes begin
      delete from search_fts where kind = 'note' and ref_id = old.id;
    end;
    create trigger tasks_search_ai after insert on tasks begin
      insert into search_fts (kind, ref_id, user_id, household_id, title, body) values ('task', new.id, new.user_id, new.household_id, replace(replace(coalesce(new.title, ''), 'ё', 'е'), 'Ё', 'Е'), replace(replace(coalesce(coalesce(new.tag, '') || ' ' || coalesce(new.note, ''), ''), 'ё', 'е'), 'Ё', 'Е'));
    end;
    create trigger tasks_search_au after update on tasks begin
      delete from search_fts where kind = 'task' and ref_id = old.id;
      insert into search_fts (kind, ref_id, user_id, household_id, title, body) values ('task', new.id, new.user_id, new.household_id, replace(replace(coalesce(new.title, ''), 'ё', 'е'), 'Ё', 'Е'), replace(replace(coalesce(coalesce(new.tag, '') || ' ' || coalesce(new.note, ''), ''), 'ё', 'е'), 'Ё', 'Е'));
    end;
    create trigger tasks_search_ad after delete on tasks begin
      delete from search_fts where kind = 'task' and ref_id = old.id;
    end;
    create trigger checklists_search_ai after insert on checklists begin
      insert into search_fts (kind, ref_id, user_id, household_id, title, body) values ('checklist', new.id, new.user_id, null, replace(replace(coalesce(new.title, ''), 'ё', 'е'), 'Ё', 'Е'), replace(replace(coalesce('', ''), 'ё', 'е'), 'Ё', 'Е'));
    end;
    create trigger checklists_search_au after update on checklists begin
      delete from search_fts where kind = 'checklist' and ref_id = old.id;
      insert into search_fts (kind, ref_id, user_id, household_id, title, body) values ('checklist', new.id, new.user_id, null, replace(replace(coalesce(new.title, ''), 'ё', 'е'), 'Ё', 'Е'), replace(replace(coalesce('', ''), 'ё', 'е'), 'Ё', 'Е'));
    end;
    create trigger checklists_search_ad after delete on checklists begin
      delete from search_fts where kind = 'checklist' and ref_id = old.id;
    end;
    create trigger checklist_items_search_ai after insert on checklist_items begin
      insert into search_fts (kind, ref_id, user_id, household_id, title, body) values ('item', new.id, new.user_id, null, replace(replace(coalesce(new.title, ''), 'ё', 'е'), 'Ё', 'Е'), replace(replace(coalesce(coalesce(new.group_name, '') || ' ' || coalesce(new.note, ''), ''), 'ё', 'е'), 'Ё', 'Е'));
    end;
    create trigger checklist_items_search_au after update on checklist_items begin
      delete from search_fts where kind = 'item' and ref_id = old.id;
      insert into search_fts (kind, ref_id, user_id, household_id, title, body) values ('item', new.id, new.user_id, null, replace(replace(coalesce(new.title, ''), 'ё', 'е'), 'Ё', 'Е'), replace(replace(coalesce(coalesce(new.group_name, '') || ' ' || coalesce(new.note, ''), ''), 'ё', 'е'), 'Ё', 'Е'));
    end;
    create trigger checklist_items_search_ad after delete on checklist_items begin
      delete from search_fts where kind = 'item' and ref_id = old.id;
    end;
    create trigger reminders_search_ai after insert on reminders begin
      insert into search_fts (kind, ref_id, user_id, household_id, title, body) values ('reminder', new.id, new.user_id, null, replace(replace(coalesce(new.title, ''), 'ё', 'е'), 'Ё', 'Е'), replace(replace(coalesce('', ''), 'ё', 'е'), 'Ё', 'Е'));
    end;
    create trigger reminders_search_au after update on reminders begin
      delete from search_fts where kind = 'reminder' and ref_id = old.id;
      insert into search_fts (kind, ref_id, user_id, household_id, title, body) values ('reminder', new.id, new.user_id, null, replace(replace(coalesce(new.title, ''), 'ё', 'е'), 'Ё', 'Е'), replace(replace(coalesce('', ''), 'ё', 'е'), 'Ё', 'Е'));
    end;
    create trigger reminders_search_ad after delete on reminders begin
      delete from search_fts where kind = 'reminder' and ref_id = old.id;
    end;
    insert into search_fts (kind, ref_id, user_id, household_id, title, body)
    select 'note', t.id, t.user_id, t.household_id, replace(replace(coalesce(t.title, ''), 'ё', 'е'), 'Ё', 'Е'), replace(replace(coalesce(t.body, ''), 'ё', 'е'), 'Ё', 'Е') from notes t;
    insert into search_fts (kind, ref_id, user_id, household_id, title, body)
    select 'task', t.id, t.user_id, t.household_id, replace(replace(coalesce(t.title, ''), 'ё', 'е'), 'Ё', 'Е'), replace(replace(coalesce(coalesce(t.tag, '') || ' ' || coalesce(t.note, ''), ''), 'ё', 'е'), 'Ё', 'Е') from tasks t;
    insert into search_fts (kind, ref_id, user_id, household_id, title, body)
    select 'checklist', t.id, t.user_id, null, replace(replace(coalesce(t.title, ''), 'ё', 'е'), 'Ё', 'Е'), replace(replace(coalesce('', ''), 'ё', 'е'), 'Ё', 'Е') from checklists t;
    insert into search_fts (kind, ref_id, user_id, household_id, title, body)
    select 'item', t.id, t.user_id, null, replace(replace(coalesce(t.title, ''), 'ё', 'е'), 'Ё', 'Е'), replace(replace(coalesce(coalesce(t.group_name, '') || ' ' || coalesce(t.note, ''), ''), 'ё', 'е'), 'Ё', 'Е') from checklist_items t;
    insert into search_fts (kind, ref_id, user_id, household_id, title, body)
    select 'reminder', t.id, t.user_id, null, replace(replace(coalesce(t.title, ''), 'ё', 'е'), 'Ё', 'Е'), replace(replace(coalesce('', ''), 'ё', 'е'), 'Ё', 'Е') from reminders t;
    `),
  },
  {
    version: 6,
    name: 'кухня: продукты, рецепты, запасы, покупки; общие чек-листы',
    up: (db) => {
      db.exec(`
    -- Справочник продуктов — один на всех (src/lib/kitchenSeed.ts). dept —
    -- отдел магазина (группа в покупках), aliases — другие названия, basic —
    -- «всегда есть», в подборе блюд не считается недостающим.
    create table products (
      id text primary key,
      name text not null unique,
      dept text not null,
      aliases text not null default '[]',
      basic integer not null default 0,
      created_by text
    );

    -- Рецепты — свои или общие для семьи, как дела.
    create table recipes (
      id text primary key,
      user_id text not null,
      household_id text references households(id) on delete set null,
      title text not null,
      category text not null default 'dinner',
      minutes integer,
      servings integer not null default 2,
      steps text not null default '[]',
      note text,
      created_at text not null default (datetime('now')),
      updated_at text not null default (datetime('now'))
    );
    create index recipes_user_idx on recipes (user_id);
    create index recipes_household_idx on recipes (household_id);
    create table recipe_ingredients (
      id text primary key,
      recipe_id text not null references recipes(id) on delete cascade,
      product_id text not null references products(id),
      qty real,
      unit text,
      position integer not null default 0
    );
    create index recipe_ingredients_recipe_idx on recipe_ingredients (recipe_id, position);

    -- «Что есть дома». scope — семья (её id) или человек ('u:' || id): у
    -- семьи запасы общие.
    create table pantry (
      scope text not null,
      product_id text not null references products(id) on delete cascade,
      added_at text not null default (datetime('now')),
      primary key (scope, product_id)
    );

    -- Чек-листы тоже бывают общими; kind = 'shopping' — список покупок (один
    -- на семью или человека). У пунктов покупок — продукт и количество:
    -- отметил купленным — продукт попадает в «что есть дома».
    alter table checklists add column household_id text references households(id) on delete set null;
    alter table checklists add column kind text not null default 'list';
    alter table checklist_items add column product_id text references products(id) on delete set null;
    alter table checklist_items add column qty real;
    alter table checklist_items add column unit text;
    alter table checklist_items add column recipe_title text;

    -- Поиск: общий чек-лист и его пункты видны всей семье.
    drop trigger checklists_search_ai;
    drop trigger checklists_search_au;
    drop trigger checklist_items_search_ai;
    drop trigger checklist_items_search_au;
    create trigger checklists_search_ai after insert on checklists begin
      insert into search_fts (kind, ref_id, user_id, household_id, title, body)
      values ('checklist', new.id, new.user_id, new.household_id, replace(replace(coalesce(new.title, ''), 'ё', 'е'), 'Ё', 'Е'), '');
    end;
    create trigger checklists_search_au after update on checklists begin
      delete from search_fts where kind = 'checklist' and ref_id = old.id;
      insert into search_fts (kind, ref_id, user_id, household_id, title, body)
      values ('checklist', new.id, new.user_id, new.household_id, replace(replace(coalesce(new.title, ''), 'ё', 'е'), 'Ё', 'Е'), '');
      update search_fts set household_id = new.household_id
      where kind = 'item' and ref_id in (select id from checklist_items where checklist_id = new.id);
    end;
    create trigger checklist_items_search_ai after insert on checklist_items begin
      insert into search_fts (kind, ref_id, user_id, household_id, title, body)
      values ('item', new.id, new.user_id, (select household_id from checklists where id = new.checklist_id), replace(replace(coalesce(new.title, ''), 'ё', 'е'), 'Ё', 'Е'), replace(replace(coalesce(coalesce(new.group_name, '') || ' ' || coalesce(new.note, ''), ''), 'ё', 'е'), 'Ё', 'Е'));
    end;
    create trigger checklist_items_search_au after update of title, group_name, note on checklist_items begin
      delete from search_fts where kind = 'item' and ref_id = old.id;
      insert into search_fts (kind, ref_id, user_id, household_id, title, body)
      values ('item', new.id, new.user_id, (select household_id from checklists where id = new.checklist_id), replace(replace(coalesce(new.title, ''), 'ё', 'е'), 'Ё', 'Е'), replace(replace(coalesce(coalesce(new.group_name, '') || ' ' || coalesce(new.note, ''), ''), 'ё', 'е'), 'Ё', 'Е'));
    end;

    -- Поиск рецептов — по названию и ингредиентам («что из яиц?»).
    create trigger recipes_search_ai after insert on recipes begin
      insert into search_fts (kind, ref_id, user_id, household_id, title, body) select 'recipe', r.id, r.user_id, r.household_id, replace(replace(coalesce(r.title, ''), 'ё', 'е'), 'Ё', 'Е'), replace(replace(coalesce((select group_concat(p.name, ' ') from recipe_ingredients i join products p on p.id = i.product_id where i.recipe_id = r.id) || ' ' || coalesce(r.note, ''), ''), 'ё', 'е'), 'Ё', 'Е') from recipes r where r.id = new.id;
    end;
    create trigger recipes_search_au after update on recipes begin
      delete from search_fts where kind = 'recipe' and ref_id = old.id;
      insert into search_fts (kind, ref_id, user_id, household_id, title, body) select 'recipe', r.id, r.user_id, r.household_id, replace(replace(coalesce(r.title, ''), 'ё', 'е'), 'Ё', 'Е'), replace(replace(coalesce((select group_concat(p.name, ' ') from recipe_ingredients i join products p on p.id = i.product_id where i.recipe_id = r.id) || ' ' || coalesce(r.note, ''), ''), 'ё', 'е'), 'Ё', 'Е') from recipes r where r.id = new.id;
    end;
    create trigger recipes_search_ad after delete on recipes begin
      delete from search_fts where kind = 'recipe' and ref_id = old.id;
    end;
    create trigger recipe_ingredients_search_ai after insert on recipe_ingredients begin
      delete from search_fts where kind = 'recipe' and ref_id = new.recipe_id;
      insert into search_fts (kind, ref_id, user_id, household_id, title, body) select 'recipe', r.id, r.user_id, r.household_id, replace(replace(coalesce(r.title, ''), 'ё', 'е'), 'Ё', 'Е'), replace(replace(coalesce((select group_concat(p.name, ' ') from recipe_ingredients i join products p on p.id = i.product_id where i.recipe_id = r.id) || ' ' || coalesce(r.note, ''), ''), 'ё', 'е'), 'Ё', 'Е') from recipes r where r.id = new.recipe_id;
    end;
    create trigger recipe_ingredients_search_ad after delete on recipe_ingredients begin
      delete from search_fts where kind = 'recipe' and ref_id = old.recipe_id;
      insert into search_fts (kind, ref_id, user_id, household_id, title, body) select 'recipe', r.id, r.user_id, r.household_id, replace(replace(coalesce(r.title, ''), 'ё', 'е'), 'Ё', 'Е'), replace(replace(coalesce((select group_concat(p.name, ' ') from recipe_ingredients i join products p on p.id = i.product_id where i.recipe_id = r.id) || ' ' || coalesce(r.note, ''), ''), 'ё', 'е'), 'Ё', 'Е') from recipes r where r.id = old.recipe_id;
    end;
      `);
      const add = db.prepare('insert into products (id, name, dept, aliases, basic) values (?, ?, ?, ?, ?)');
      for (const p of SEED_PRODUCTS) add.run(randomUUID(), p.name, p.dept, JSON.stringify(p.aliases ?? []), p.basic ? 1 : 0);
    },
  },
  {
    version: 7,
    name: 'журнал тренировок: упражнения, тренировки, подходы, шаблоны',
    up: (db) =>
      db.exec(`
    -- Тренировки — личные. Упражнения — свой справочник человека (заводятся
    -- по названию при первом использовании).
    create table exercises (
      id text primary key,
      user_id text not null,
      name text not null,
      created_at text not null default (datetime('now')),
      unique (user_id, name)
    );

    -- Тренировка: день (местный), начало и конец (UTC), заметка.
    create table workouts (
      id text primary key,
      user_id text not null,
      title text not null,
      day text not null,
      started_at text not null default (datetime('now')),
      finished_at text,
      note text,
      template_id text
    );
    create index workouts_user_idx on workouts (user_id, day);

    -- Упражнения в тренировке по порядку и их подходы. weight null — свой
    -- вес (подтягивания); reps — повторы.
    create table workout_exercises (
      id text primary key,
      workout_id text not null references workouts(id) on delete cascade,
      exercise_id text not null references exercises(id),
      position integer not null default 0
    );
    create index workout_exercises_workout_idx on workout_exercises (workout_id, position);
    create table workout_sets (
      id text primary key,
      workout_exercise_id text not null references workout_exercises(id) on delete cascade,
      weight real,
      reps integer not null,
      position integer not null default 0,
      created_at text not null default (datetime('now'))
    );
    create index workout_sets_we_idx on workout_sets (workout_exercise_id, position);

    -- Шаблоны: упражнения с планом подходов и дни недели («ноги — пн, чт»):
    -- в эти дни главная предлагает начать тренировку по шаблону.
    create table workout_templates (
      id text primary key,
      user_id text not null,
      title text not null,
      weekdays text not null default '[]',
      plan text not null default '[]',
      created_at text not null default (datetime('now'))
    );
    `),
  },
  {
    version: 8,
    name: 'коды из писем: регистрация и сброс пароля',
    up: (db) =>
      db.exec(`
    -- Коды подтверждения почты (src/server/emailCodes.ts). Хранится только
    -- хэш кода; у кода срок, счётчик попыток и IP — для ограничений.
    create table email_codes (
      id text primary key,
      email text not null,
      purpose text not null check (purpose in ('register', 'reset')),
      code_hash text not null,
      expires_at text not null,
      attempts integer not null default 0,
      ip text,
      created_at text not null
    );
    create index email_codes_email_idx on email_codes (email, purpose, created_at);
    create index email_codes_ip_idx on email_codes (ip, created_at);
    `),
  },
  {
    version: 9,
    name: 'ИИ: лимит запросов и утренняя сводка; поддержка: обращения',
    up: (db) =>
      db.exec(`
    -- Сколько запросов к ИИ человек сделал за день (src/server/ai.ts).
    create table ai_usage (
      user_id text not null,
      day text not null,
      count integer not null default 0,
      primary key (user_id, day)
    );
    -- Утренняя сводка в push: во сколько (null — выключена).
    alter table user_settings add column summary_time text;

    -- Обращения в поддержку (src/server/api/support.ts): идея, ошибка,
    -- вопрос; статус и ответ видит автор.
    create table feedback (
      id text primary key,
      user_id text not null,
      kind text not null check (kind in ('idea', 'bug', 'question', 'other')),
      text text not null,
      page text,
      status text not null default 'new' check (status in ('new', 'in_progress', 'done')),
      reply text,
      created_at text not null default (datetime('now')),
      updated_at text not null default (datetime('now'))
    );
    create index feedback_user_idx on feedback (user_id, created_at);
    create index feedback_status_idx on feedback (status, created_at);
    `),
  },
  {
    version: 10,
    name: 'Повтор push до отметки, свои разделы меню, календарь по подписке',
    up: (db) =>
      db.exec(`
    -- Не отметили «сделано» — повторить push через столько минут (до 3 раз).
    alter table reminders add column nag integer;
    -- Порядок и скрытые разделы меню: JSON [{"href":"/tasks","hidden":false}, …].
    alter table user_settings add column nav text;
    -- Секрет ссылки-подписки на календарь (.ics); null — не включали.
    alter table user_settings add column calendar_token text;
    create unique index user_settings_calendar_idx on user_settings (calendar_token) where calendar_token is not null;
    `),
  },
  {
    version: 11,
    name: 'Знакомство, тихие часы, итог дня',
    up: (db) =>
      db.exec(`
    -- Прошёл ли знакомство (город, уведомления, первое дело). У тех, кто уже
    -- пользуется, — считаем, что прошёл.
    alter table user_settings add column onboarded integer not null default 0;
    update user_settings set onboarded = 1;
    -- Тихие часы: push не шлём с quiet_from до quiet_to (null — выключены).
    alter table user_settings add column quiet_from text default '23:00';
    alter table user_settings add column quiet_to text default '07:00';
    -- Итог дня вечером: во сколько (null — выключен).
    alter table user_settings add column review_time text;
    `),
  },
  {
    version: 12,
    name: 'Покупки: отделы для продуктов, заведённых людьми',
    up: (db) => {
      // Раньше новые продукты попадали в «Другое» — угадываем отдел по названию.
      const rows = db.prepare("select id, name from products where dept = 'Другое'").all() as { id: string; name: string }[];
      const set = db.prepare('update products set dept = ? where id = ?');
      const items = db.prepare('update checklist_items set group_name = ? where product_id = ?');
      for (const r of rows) {
        const dept = guessDept(r.name);
        if (dept === 'Другое') continue;
        set.run(dept, r.id);
        items.run(dept, r.id);
      }
    },
  },
  {
    version: 13,
    name: 'Метка у напоминаний',
    up: (db) =>
      db.exec(`
    -- Как у дел («дом», «работа»): дело со временем сохраняется напоминанием.
    alter table reminders add column tag text;
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
