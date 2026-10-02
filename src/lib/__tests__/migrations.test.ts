import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { LATEST, MIGRATIONS, migrate, schemaVersion } from '../migrations';

const tables = (db: Database.Database) =>
  (db.prepare("select name from sqlite_master where type = 'table' order by name").all() as { name: string }[]).map(
    (r) => r.name,
  );

describe('migrate', () => {
  it('доводит новую базу до последней версии', () => {
    const db = new Database(':memory:');
    expect(migrate(db)).toBe(MIGRATIONS.length);
    expect(schemaVersion(db)).toBe(LATEST);
    expect(tables(db)).toEqual(expect.arrayContaining(['users', 'sessions', 'checklists', 'reminders', 'push_subscriptions']));
  });

  it('второй прогон ничего не делает и не зовёт снимок', () => {
    const db = new Database(':memory:');
    migrate(db);
    let called = false;
    expect(migrate(db, () => (called = true))).toBe(0);
    expect(called).toBe(false);
  });

  it('принимает базу «до миграций» с данными и не теряет их', () => {
    const db = new Database(':memory:');
    db.exec("create table checklists (id text primary key, user_id text not null, title text not null, icon text not null default 'bag', position integer not null default 0, created_at text not null default (datetime('now')))");
    db.prepare("insert into checklists (id, user_id, title) values ('c1', 'u1', 'Бассейн')").run();
    let from = -1;
    migrate(db, (v) => (from = v));
    expect(from).toBe(0);
    expect(db.prepare('select title from checklists').get()).toEqual({ title: 'Бассейн' });
  });

  it('номера версий идут подряд с 1', () => {
    MIGRATIONS.forEach((m, i) => expect(m.version).toBe(i + 1));
  });

  it('v2: старые напоминания переходят на правила, отметки сохраняются', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    MIGRATIONS[0].up(db);
    db.pragma('user_version = 1');
    const add = db.prepare(
      "insert into reminders (id, user_id, title, at_time, repeat, on_date, created_at) values (?, 'u', ?, ?, ?, ?, '2026-09-01 10:00:00')",
    );
    add.run('once', 'Врач', '09:30:00', 'once', '2026-10-05');
    add.run('daily', 'Таблетки', '21:00', 'daily', null);
    add.run('wd', 'Работа', '08:00', 'weekdays', null);
    db.prepare("insert into reminder_done (reminder_id, user_id, day) values ('daily', 'u', '2026-10-01')").run();
    db.prepare("insert into push_sent (reminder_id, day) values ('wd', '2026-10-01')").run();

    migrate(db);
    expect(schemaVersion(db)).toBe(LATEST);
    const rows = db.prepare('select id, times, rule from reminders order by id').all() as { id: string; times: string; rule: string }[];
    const byId = Object.fromEntries(rows.map((r) => [r.id, { times: JSON.parse(r.times), rule: JSON.parse(r.rule) }]));
    expect(byId.once).toEqual({ times: ['09:30'], rule: { kind: 'once', date: '2026-10-05' } });
    expect(byId.daily.rule).toEqual({ kind: 'repeat', unit: 'day', every: 1, start: '2026-09-01' });
    expect(byId.wd.rule).toEqual({ kind: 'repeat', unit: 'week', every: 1, start: '2026-09-01', weekdays: [1, 2, 3, 4, 5] });
    expect(db.prepare('select reminder_id, day, slot from reminder_done').all()).toEqual([
      { reminder_id: 'daily', day: '2026-10-01', slot: '21:00' },
    ]);
    expect(db.prepare('select slot from push_sent').get()).toEqual({ slot: '08:00' });
    // ключи снова включены, и каскад работает с новыми таблицами
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    db.prepare("delete from reminders where id = 'daily'").run();
    expect(db.prepare('select count(*) as n from reminder_done').get()).toEqual({ n: 0 });
  });
});
